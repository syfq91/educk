use std::path::{Path, PathBuf};
use tauri::Manager;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PathError {
    #[error("Invalid book ID: '{0}'. Book IDs must be valid UUIDs or safe alphanumeric identifiers without path traversal characters.")]
    InvalidBookId(String),

    #[error("Failed to resolve app data directory: {0}")]
    AppDataDirUnavailable(String),

    #[error("Filesystem I/O error: {0}")]
    Io(#[from] std::io::Error),
}

/// Validates that a book ID is secure against path traversal attacks.
/// Rejects any attempt to use "..", slashes, backslashes, null bytes, or non-alphanumeric chars (except '-' and '_').
pub fn validate_book_id(book_id: &str) -> Result<(), PathError> {
    if book_id.is_empty() || book_id.len() > 64 {
        return Err(PathError::InvalidBookId(book_id.to_string()));
    }

    // Must be a valid UUID or a safe alphanumeric identifier
    let is_valid_char = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_';
    if !book_id.chars().all(is_valid_char) {
        return Err(PathError::InvalidBookId(book_id.to_string()));
    }

    // Prevent any reserved Windows / UNIX dot names
    if book_id == "." || book_id == ".." || book_id.contains("..") {
        return Err(PathError::InvalidBookId(book_id.to_string()));
    }

    Ok(())
}

/// Resolves the scoped books directory: `$appData/books/`
pub fn get_books_dir(app: &tauri::AppHandle) -> Result<PathBuf, PathError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| PathError::AppDataDirUnavailable(e.to_string()))?;
    Ok(app_data.join("books"))
}

/// Resolves the specific book directory: `$appData/books/<book_id>/`
pub fn get_book_dir(app: &tauri::AppHandle, book_id: &str) -> Result<PathBuf, PathError> {
    validate_book_id(book_id)?;
    let books_dir = get_books_dir(app)?;
    Ok(books_dir.join(book_id))
}

/// Resolves the temporary download path: `$appData/books/<book_id>/book.epub.part`
pub fn get_part_path(app: &tauri::AppHandle, book_id: &str) -> Result<PathBuf, PathError> {
    let book_dir = get_book_dir(app, book_id)?;
    Ok(book_dir.join("book.epub.part"))
}

/// Resolves the final committed book path: `$appData/books/<book_id>/book.epub`
pub fn get_final_path(app: &tauri::AppHandle, book_id: &str) -> Result<PathBuf, PathError> {
    let book_dir = get_book_dir(app, book_id)?;
    Ok(book_dir.join("book.epub"))
}

/// Ensures that the book storage directory exists on disk.
pub async fn ensure_book_dir(app: &tauri::AppHandle, book_id: &str) -> Result<PathBuf, PathError> {
    let dir = get_book_dir(app, book_id)?;
    tokio::fs::create_dir_all(&dir).await?;
    Ok(dir)
}

/// Atomically renames a `.part` file to the final destination `.epub`.
pub async fn atomic_commit(part_path: &Path, final_path: &Path) -> Result<(), PathError> {
    tokio::fs::rename(part_path, final_path).await?;
    Ok(())
}

/// Cleans up any leftover `.part` file if it exists.
pub async fn cleanup_part(part_path: &Path) -> Result<(), PathError> {
    if tokio::fs::try_exists(part_path).await.unwrap_or(false) {
        let _ = tokio::fs::remove_file(part_path).await;
    }
    Ok(())
}

/// Deletes the book directory and all contained files.
pub async fn delete_book_dir(app: &tauri::AppHandle, book_id: &str) -> Result<(), PathError> {
    let dir = get_book_dir(app, book_id)?;
    if tokio::fs::try_exists(&dir).await.unwrap_or(false) {
        tokio::fs::remove_dir_all(&dir).await?;
    }
    Ok(())
}

/// Scans the application books directory (`$appData/books/`) and removes any orphan `book.epub.part`
/// files left behind by ungraceful process termination or crashes, returning the count of cleaned files.
pub async fn cleanup_all_orphan_parts(app: &tauri::AppHandle) -> Result<usize, PathError> {
    let books_dir = get_books_dir(app)?;
    if !tokio::fs::try_exists(&books_dir).await.unwrap_or(false) {
        return Ok(0);
    }

    let mut count = 0;
    if let Ok(mut entries) = tokio::fs::read_dir(&books_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.is_dir() {
                let part_file = path.join("book.epub.part");
                if tokio::fs::try_exists(&part_file).await.unwrap_or(false)
                    && tokio::fs::remove_file(&part_file).await.is_ok()
                {
                    count += 1;
                }
            }
        }
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_book_ids() {
        assert!(validate_book_id("c9bf9e57-1685-4c89-bafb-ff5af830be8a").is_ok());
        assert!(validate_book_id("sample-epub3").is_ok());
        assert!(validate_book_id("book_123_abc").is_ok());
    }

    #[test]
    fn test_rejects_path_traversal_book_ids() {
        assert!(validate_book_id("../etc/passwd").is_err());
        assert!(validate_book_id("..\\windows\\system32").is_err());
        assert!(validate_book_id(".").is_err());
        assert!(validate_book_id("..").is_err());
        assert!(validate_book_id("foo/bar").is_err());
        assert!(validate_book_id("foo\\bar").is_err());
        assert!(validate_book_id("foo\0bar").is_err());
        assert!(validate_book_id("").is_err());
    }
}
