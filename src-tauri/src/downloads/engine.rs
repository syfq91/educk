use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, USER_AGENT};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

use crate::downloads::models::DownloadError;

const DEFAULT_USER_AGENT: &str = "educk/0.1.0 (Android; DRM-free Ebook Reader)";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const READ_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_RETRIES: usize = 3;
const INITIAL_BACKOFF: Duration = Duration::from_millis(500);

pub struct DownloadEngine {
    client: reqwest::Client,
}

impl DownloadEngine {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(READ_TIMEOUT)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { client }
    }

    /// Streams a remote file directly to disk at `part_path`.
    /// Handles retries with exponential backoff for transient failures.
    pub async fn stream_to_file<F>(
        &self,
        url: &str,
        headers: Option<&std::collections::HashMap<String, String>>,
        part_path: &Path,
        cancel_flag: Arc<AtomicBool>,
        mut on_progress: F,
    ) -> Result<u64, DownloadError>
    where
        F: FnMut(u64, Option<u64>),
    {
        let mut attempt = 0;
        let mut backoff = INITIAL_BACKOFF;

        loop {
            if cancel_flag.load(Ordering::SeqCst) {
                return Err(DownloadError::Cancelled);
            }

            attempt += 1;
            match self
                .single_stream_attempt(url, headers, part_path, cancel_flag.clone(), &mut on_progress)
                .await
            {
                Ok(bytes) => return Ok(bytes),
                Err(err) => {
                    // Check if cancelled
                    if matches!(err, DownloadError::Cancelled) || cancel_flag.load(Ordering::SeqCst) {
                        return Err(DownloadError::Cancelled);
                    }

                    // Check if error is non-retryable (e.g. 401, 403, 404)
                    if let DownloadError::HttpStatus { status, .. } = &err {
                        if *status == 401 || *status == 403 || *status == 404 {
                            return Err(err);
                        }
                    }

                    if attempt >= MAX_RETRIES {
                        return Err(err);
                    }

                    // Clean up partial attempt file before retry
                    let _ = tokio::fs::remove_file(part_path).await;

                    // Sleep for exponential backoff before retrying
                    tokio::time::sleep(backoff).await;
                    backoff *= 2;
                }
            }
        }
    }

    async fn single_stream_attempt<F>(
        &self,
        url: &str,
        headers: Option<&std::collections::HashMap<String, String>>,
        part_path: &Path,
        cancel_flag: Arc<AtomicBool>,
        on_progress: &mut F,
    ) -> Result<u64, DownloadError>
    where
        F: FnMut(u64, Option<u64>),
    {
        let mut request = self.client.get(url).header(USER_AGENT, DEFAULT_USER_AGENT);

        if let Some(custom_headers) = headers {
            let mut header_map = HeaderMap::new();
            for (key, val) in custom_headers {
                if let (Ok(h_name), Ok(h_val)) = (
                    HeaderName::from_bytes(key.as_bytes()),
                    HeaderValue::from_str(val),
                ) {
                    header_map.insert(h_name, h_val);
                }
            }
            request = request.headers(header_map);
        }

        let response = request
            .send()
            .await
            .map_err(|e| DownloadError::Network(e.to_string()))?;

        let status = response.status();
        if !status.is_success() {
            return Err(DownloadError::HttpStatus {
                status: status.as_u16(),
                message: status.canonical_reason().unwrap_or("Unknown").to_string(),
            });
        }

        let total_bytes = response.content_length();
        let mut file = tokio::fs::File::create(part_path)
            .await
            .map_err(DownloadError::Io)?;

        let mut downloaded_bytes: u64 = 0;
        let mut stream = response.bytes_stream();
        let mut last_progress_emit = std::time::Instant::now();

        on_progress(0, total_bytes);

        while let Some(chunk_result) = stream.next().await {
            if cancel_flag.load(Ordering::SeqCst) {
                drop(file);
                let _ = tokio::fs::remove_file(part_path).await;
                return Err(DownloadError::Cancelled);
            }

            let chunk = chunk_result.map_err(|e| DownloadError::Network(e.to_string()))?;
            file.write_all(&chunk).await.map_err(DownloadError::Io)?;

            downloaded_bytes += chunk.len() as u64;

            // Throttle progress updates to avoid saturating IPC (at most every 100ms)
            if last_progress_emit.elapsed() >= Duration::from_millis(100) {
                on_progress(downloaded_bytes, total_bytes);
                last_progress_emit = std::time::Instant::now();
            }
        }

        file.flush().await.map_err(DownloadError::Io)?;
        on_progress(downloaded_bytes, total_bytes);

        Ok(downloaded_bytes)
    }
}

impl Default for DownloadEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn test_stream_happy_path() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let response = "HTTP/1.1 200 OK\r\nContent-Length: 12\r\nConnection: close\r\n\r\nHello World!";
                let _ = socket.write_all(response.as_bytes()).await;
            }
        });

        let engine = DownloadEngine::new();
        let temp_dest = NamedTempFile::new().unwrap();
        let dest_path = temp_dest.path().to_path_buf();
        let cancel_flag = Arc::new(AtomicBool::new(false));

        let mut progress_count = 0;
        let res = engine
            .stream_to_file(
                &format!("http://{}", addr),
                None,
                &dest_path,
                cancel_flag,
                |_downloaded, _total| {
                    progress_count += 1;
                },
            )
            .await;

        assert!(res.is_ok(), "Streaming should succeed: {:?}", res);
        assert_eq!(res.unwrap(), 12);
        assert!(progress_count > 0);

        let content = tokio::fs::read_to_string(&dest_path).await.unwrap();
        assert_eq!(content, "Hello World!");
    }

    #[tokio::test]
    async fn test_stream_cancellation() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let response = "HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\nSome Initial Content";
                let _ = socket.write_all(response.as_bytes()).await;
                // keep socket open
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        });

        let engine = DownloadEngine::new();
        let temp_dir = tempfile::tempdir().unwrap();
        let part_path = temp_dir.path().join("test.epub.part");
        let cancel_flag = Arc::new(AtomicBool::new(true)); // cancel immediately

        let res = engine
            .stream_to_file(
                &format!("http://{}", addr),
                None,
                &part_path,
                cancel_flag,
                |_downloaded, _total| {},
            )
            .await;

        assert!(matches!(res, Err(DownloadError::Cancelled)));
        assert!(!part_path.exists(), "Cancelled download must clean up part file");
    }

    #[tokio::test]
    async fn test_stream_http_error_does_not_retry_404() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let response = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                let _ = socket.write_all(response.as_bytes()).await;
            }
        });

        let engine = DownloadEngine::new();
        let temp_dir = tempfile::tempdir().unwrap();
        let part_path = temp_dir.path().join("404.epub.part");
        let cancel_flag = Arc::new(AtomicBool::new(false));

        let res = engine
            .stream_to_file(
                &format!("http://{}", addr),
                None,
                &part_path,
                cancel_flag,
                |_downloaded, _total| {},
            )
            .await;

        match res {
            Err(DownloadError::HttpStatus { status, .. }) => {
                assert_eq!(status, 404);
            }
            other => panic!("Expected HttpStatus 404, got: {:?}", other),
        }
    }
}
