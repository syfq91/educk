use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;

use crate::downloads::engine::DownloadEngine;
use crate::downloads::models::{
    DownloadError, DownloadProgressPayload, DownloadRequest, DownloadResult, DownloadStatus,
};
use crate::downloads::validator::validate_epub_archive;
use crate::filesystem::paths::{
    atomic_commit, cleanup_part, ensure_book_dir, get_final_path, get_part_path, validate_book_id,
};

const DOWNLOAD_PROGRESS_EVENT: &str = "download://progress";

struct ActiveDownload {
    cancel_flag: Arc<AtomicBool>,
    latest_progress: DownloadProgressPayload,
}

pub struct DownloadManager {
    engine: DownloadEngine,
    active_downloads: Arc<RwLock<HashMap<String, ActiveDownload>>>,
}

impl DownloadManager {
    pub fn new() -> Self {
        Self {
            engine: DownloadEngine::new(),
            active_downloads: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Initiates an atomic book download.
    /// Deduplicates active downloads, streams to `$appData/books/<id>/book.epub.part`,
    /// validates the archive integrity, and commits via atomic rename to `book.epub`.
    pub async fn start_download(
        &self,
        app: AppHandle,
        request: DownloadRequest,
    ) -> Result<DownloadResult, DownloadError> {
        let book_id = request.book_id.clone();
        validate_book_id(&book_id)?;

        // Security: Whitelist HTTP and HTTPS download URLs only (reject file://, data:, javascript:)
        if !request.url.starts_with("http://") && !request.url.starts_with("https://") {
            return Err(DownloadError::InvalidUrl(
                "Only HTTP and HTTPS URLs are permitted for downloads".to_string(),
            ));
        }

        // Deduplication check
        {
            let active = self.active_downloads.read().await;
            if active.contains_key(&book_id) {
                return Err(DownloadError::AlreadyInProgress(book_id));
            }
        }

        // Ensure sandboxed storage directory exists
        let _ = ensure_book_dir(&app, &book_id).await?;
        let part_path = get_part_path(&app, &book_id)?;
        let final_path = get_final_path(&app, &book_id)?;

        // Ensure clean state before starting
        let _ = cleanup_part(&part_path).await;

        let cancel_flag = Arc::new(AtomicBool::new(false));
        let initial_payload = DownloadProgressPayload {
            book_id: book_id.clone(),
            status: DownloadStatus::Downloading,
            bytes_downloaded: 0,
            total_bytes: request.expected_size,
            progress: 0.0,
            error: None,
        };

        // Register active download
        {
            let mut active = self.active_downloads.write().await;
            active.insert(
                book_id.clone(),
                ActiveDownload {
                    cancel_flag: cancel_flag.clone(),
                    latest_progress: initial_payload.clone(),
                },
            );
        }

        let _ = app.emit(DOWNLOAD_PROGRESS_EVENT, &initial_payload);

        let app_clone = app.clone();
        let book_id_clone = book_id.clone();
        let active_downloads_clone = self.active_downloads.clone();

        let progress_callback = move |downloaded: u64, total: Option<u64>| {
            let progress = match total {
                Some(t) if t > 0 => (downloaded as f64 / t as f64).min(1.0),
                _ => -1.0,
            };

            let payload = DownloadProgressPayload {
                book_id: book_id_clone.clone(),
                status: DownloadStatus::Downloading,
                bytes_downloaded: downloaded,
                total_bytes: total,
                progress,
                error: None,
            };

            let _ = app_clone.emit(DOWNLOAD_PROGRESS_EVENT, &payload);

            // Update in-memory active status
            if let Ok(mut active) = active_downloads_clone.try_write() {
                if let Some(dl) = active.get_mut(&book_id_clone) {
                    dl.latest_progress = payload;
                }
            }
        };

        // Stream from remote source
        let stream_result = self
            .engine
            .stream_to_file(
                &request.url,
                request.headers.as_ref(),
                &part_path,
                cancel_flag.clone(),
                progress_callback,
            )
            .await;

        match stream_result {
            Ok(total_downloaded) => {
                // Verification phase
                let verifying_payload = DownloadProgressPayload {
                    book_id: book_id.clone(),
                    status: DownloadStatus::Verifying,
                    bytes_downloaded: total_downloaded,
                    total_bytes: Some(total_downloaded),
                    progress: 1.0,
                    error: None,
                };
                let _ = app.emit(DOWNLOAD_PROGRESS_EVENT, &verifying_payload);

                // Run EPUB validation on the temporary file
                match validate_epub_archive(&part_path) {
                    Ok(_report) => {
                        // Atomic rename: .part -> .epub
                        if let Err(e) = atomic_commit(&part_path, &final_path).await {
                            let _ = cleanup_part(&part_path).await;
                            self.emit_failure(&app, &book_id, e.to_string()).await;
                            return Err(DownloadError::Path(e));
                        }

                        let final_size = tokio::fs::metadata(&final_path)
                            .await
                            .map(|m| m.len())
                            .unwrap_or(total_downloaded);

                        let completed_payload = DownloadProgressPayload {
                            book_id: book_id.clone(),
                            status: DownloadStatus::Completed,
                            bytes_downloaded: final_size,
                            total_bytes: Some(final_size),
                            progress: 1.0,
                            error: None,
                        };
                        let _ = app.emit(DOWNLOAD_PROGRESS_EVENT, &completed_payload);

                        self.active_downloads.write().await.remove(&book_id);

                        Ok(DownloadResult {
                            book_id,
                            local_path: final_path.to_string_lossy().to_string(),
                            file_size: final_size,
                        })
                    }
                    Err(validation_err) => {
                        // Purge corrupted download
                        let _ = cleanup_part(&part_path).await;
                        let err_msg = validation_err.to_string();
                        self.emit_failure(&app, &book_id, err_msg.clone()).await;
                        Err(DownloadError::Validation(err_msg))
                    }
                }
            }
            Err(DownloadError::Cancelled) => {
                let _ = cleanup_part(&part_path).await;
                let cancelled_payload = DownloadProgressPayload {
                    book_id: book_id.clone(),
                    status: DownloadStatus::Cancelled,
                    bytes_downloaded: 0,
                    total_bytes: None,
                    progress: 0.0,
                    error: None,
                };
                let _ = app.emit(DOWNLOAD_PROGRESS_EVENT, &cancelled_payload);
                self.active_downloads.write().await.remove(&book_id);
                Err(DownloadError::Cancelled)
            }
            Err(err) => {
                let _ = cleanup_part(&part_path).await;
                let err_msg = err.to_string();
                self.emit_failure(&app, &book_id, err_msg).await;
                Err(err)
            }
        }
    }

    /// Cancels an in-progress download by book ID.
    pub async fn cancel_download(&self, book_id: &str) -> bool {
        let active = self.active_downloads.read().await;
        if let Some(dl) = active.get(book_id) {
            dl.cancel_flag.store(true, Ordering::SeqCst);
            true
        } else {
            false
        }
    }

    /// Queries the current progress of an active download.
    pub async fn get_status(&self, book_id: &str) -> Option<DownloadProgressPayload> {
        let active = self.active_downloads.read().await;
        active.get(book_id).map(|dl| dl.latest_progress.clone())
    }

    async fn emit_failure(&self, app: &AppHandle, book_id: &str, error: String) {
        let failed_payload = DownloadProgressPayload {
            book_id: book_id.to_string(),
            status: DownloadStatus::Failed,
            bytes_downloaded: 0,
            total_bytes: None,
            progress: 0.0,
            error: Some(error),
        };
        let _ = app.emit(DOWNLOAD_PROGRESS_EVENT, &failed_payload);
        self.active_downloads.write().await.remove(book_id);
    }
}

impl Default for DownloadManager {
    fn default() -> Self {
        Self::new()
    }
}
