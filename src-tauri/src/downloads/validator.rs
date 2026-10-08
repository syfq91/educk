use std::fs::File;
use std::io::Read;
use std::path::Path;
use thiserror::Error;

const MAX_UNCOMPRESSED_BYTES: u64 = 500 * 1024 * 1024; // 500 MB limit against ZIP bombs
const MAX_COMPRESSION_RATIO: f64 = 100.0; // 100:1 ratio limit
const MAX_ENTRY_COUNT: usize = 10_000; // Limit against archive entry exhaustion attacks

#[derive(Debug, Error)]
pub enum ValidationError {
    #[error("Not a valid ZIP archive: {0}")]
    NotAValidZip(String),

    #[error("Missing 'mimetype' entry in EPUB archive")]
    MissingMimetype,

    #[error("Invalid mimetype content: expected 'application/epub+zip', found '{0}'")]
    InvalidMimetype(String),

    #[error("Missing standard 'META-INF/container.xml' entry")]
    MissingContainer,

    #[error("Potential ZIP Slip path traversal attack detected in entry: '{0}'")]
    ZipSlipAttempt(String),

    #[error("Potential ZIP bomb detected: entry count {0} exceeds safety limit")]
    TooManyEntries(usize),

    #[error("Potential ZIP bomb detected: uncompressed size {uncompressed} bytes exceeds limit or ratio {ratio:.1}:1 exceeds threshold")]
    ZipBombDetected { uncompressed: u64, ratio: f64 },

    #[error("I/O error reading archive: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone)]
pub struct EpubValidationReport {
    pub file_size: u64,
    pub entry_count: usize,
    pub total_uncompressed_bytes: u64,
}

/// Validates an EPUB archive (.part or .epub) for structural integrity and defensive security:
/// 1. Verifies that the file is a readable ZIP archive.
/// 2. Ensures the presence and exact content of the `mimetype` file (`application/epub+zip`).
/// 3. Ensures the presence of `META-INF/container.xml`.
/// 4. Protects against ZIP Slip (directory traversal in entry paths).
/// 5. Protects against ZIP bombs (decompression size limit and ratio checks).
pub fn validate_epub_archive(path: &Path) -> Result<EpubValidationReport, ValidationError> {
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    let file_size = metadata.len();

    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| ValidationError::NotAValidZip(e.to_string()))?;

    let entry_count = archive.len();
    if entry_count > MAX_ENTRY_COUNT {
        return Err(ValidationError::TooManyEntries(entry_count));
    }
    let mut has_mimetype = false;
    let mut has_container = false;
    let mut total_uncompressed: u64 = 0;
    let mut total_compressed: u64 = 0;

    // Scan all entries for security constraints
    for i in 0..entry_count {
        let entry = archive
            .by_index(i)
            .map_err(|e| ValidationError::NotAValidZip(e.to_string()))?;

        let name = entry.name().to_string();

        // ZIP Slip check: entries must not contain path traversal
        if name.contains("..") || name.starts_with('/') || name.starts_with('\\') {
            return Err(ValidationError::ZipSlipAttempt(name));
        }

        total_uncompressed += entry.size();
        total_compressed += entry.compressed_size();

        if total_uncompressed > MAX_UNCOMPRESSED_BYTES {
            let ratio = if total_compressed > 0 {
                total_uncompressed as f64 / total_compressed as f64
            } else {
                total_uncompressed as f64
            };
            return Err(ValidationError::ZipBombDetected {
                uncompressed: total_uncompressed,
                ratio,
            });
        }

        if name == "mimetype" {
            has_mimetype = true;
        } else if name == "META-INF/container.xml" {
            has_container = true;
        }
    }

    // Compression ratio bomb check
    if total_compressed > 0 {
        let ratio = total_uncompressed as f64 / total_compressed as f64;
        if ratio > MAX_COMPRESSION_RATIO && total_uncompressed > 10 * 1024 * 1024 {
            return Err(ValidationError::ZipBombDetected {
                uncompressed: total_uncompressed,
                ratio,
            });
        }
    }

    if !has_mimetype {
        return Err(ValidationError::MissingMimetype);
    }

    // Validate mimetype content
    let mut mimetype_entry = archive
        .by_name("mimetype")
        .map_err(|_| ValidationError::MissingMimetype)?;

    let mut mimetype_content = String::new();
    mimetype_entry.read_to_string(&mut mimetype_content)?;
    let trimmed = mimetype_content.trim();
    if trimmed != "application/epub+zip" {
        return Err(ValidationError::InvalidMimetype(trimmed.to_string()));
    }

    if !has_container {
        return Err(ValidationError::MissingContainer);
    }

    Ok(EpubValidationReport {
        file_size,
        entry_count,
        total_uncompressed_bytes: total_uncompressed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_valid_epub3_fixture() {
        let path = Path::new("../fixtures/books/valid-sample.epub");
        if path.exists() {
            let res = validate_epub_archive(path);
            assert!(res.is_ok(), "valid-sample.epub should pass validation: {:?}", res);
            let report = res.unwrap();
            assert!(report.entry_count > 0);
            assert!(report.file_size > 0);
        }
    }

    #[test]
    fn test_valid_epub2_fixture() {
        let path = Path::new("../fixtures/books/valid-epub2.epub");
        if path.exists() {
            let res = validate_epub_archive(path);
            assert!(res.is_ok(), "valid-epub2.epub should pass validation: {:?}", res);
        }
    }

    #[test]
    fn test_corrupted_invalid_zip() {
        let path = Path::new("../fixtures/books/corrupted-invalid-zip.epub");
        if path.exists() {
            let res = validate_epub_archive(path);
            assert!(res.is_err());
            match res.unwrap_err() {
                ValidationError::NotAValidZip(_) => {}
                other => panic!("Expected NotAValidZip, got: {:?}", other),
            }
        }
    }

    #[test]
    fn test_corrupted_missing_container() {
        let path = Path::new("../fixtures/books/corrupted-missing-container.epub");
        if path.exists() {
            let res = validate_epub_archive(path);
            assert!(res.is_err());
            match res.unwrap_err() {
                ValidationError::MissingContainer => {}
                other => panic!("Expected MissingContainer, got: {:?}", other),
            }
        }
    }

    #[test]
    fn test_rejects_missing_mimetype() {
        let file = NamedTempFile::new().unwrap();
        {
            let mut zip = zip::ZipWriter::new(&file);
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("META-INF/container.xml", options).unwrap();
            zip.write_all(b"<container/>").unwrap();
            zip.finish().unwrap();
        }

        let res = validate_epub_archive(file.path());
        assert!(matches!(res, Err(ValidationError::MissingMimetype)));
    }

    #[test]
    fn test_rejects_invalid_mimetype_content() {
        let file = NamedTempFile::new().unwrap();
        {
            let mut zip = zip::ZipWriter::new(&file);
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("mimetype", options).unwrap();
            zip.write_all(b"text/plain").unwrap();
            zip.start_file("META-INF/container.xml", options).unwrap();
            zip.write_all(b"<container/>").unwrap();
            zip.finish().unwrap();
        }

        let res = validate_epub_archive(file.path());
        assert!(matches!(res, Err(ValidationError::InvalidMimetype(_))));
    }

    #[test]
    fn test_rejects_zip_slip_path() {
        let file = NamedTempFile::new().unwrap();
        {
            let mut zip = zip::ZipWriter::new(&file);
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("mimetype", options).unwrap();
            zip.write_all(b"application/epub+zip").unwrap();
            zip.start_file("META-INF/container.xml", options).unwrap();
            zip.write_all(b"<container/>").unwrap();
            zip.start_file("../evil.sh", options).unwrap();
            zip.write_all(b"malicious").unwrap();
            zip.finish().unwrap();
        }

        let res = validate_epub_archive(file.path());
        assert!(matches!(res, Err(ValidationError::ZipSlipAttempt(_))));
    }

    #[test]
    fn test_rejects_too_many_entries() {
        let file = NamedTempFile::new().unwrap();
        {
            let mut zip = zip::ZipWriter::new(&file);
            let options = zip::write::SimpleFileOptions::default();
            for i in 0..=MAX_ENTRY_COUNT {
                zip.start_file(format!("file_{}.txt", i), options).unwrap();
            }
            zip.finish().unwrap();
        }

        let res = validate_epub_archive(file.path());
        assert!(matches!(res, Err(ValidationError::TooManyEntries(_))));
    }
}
