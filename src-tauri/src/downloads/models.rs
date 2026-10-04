use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

use crate::filesystem::PathError;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub book_id: String,
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub expected_size: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Idle,
    Downloading,
    Verifying,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressPayload {
    pub book_id: String,
    pub status: DownloadStatus,
    pub bytes_downloaded: u64,
    pub total_bytes: Option<u64>,
    pub progress: f64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub book_id: String,
    pub local_path: String,
    pub file_size: u64,
}

#[derive(Debug, Error)]
pub enum DownloadError {
    #[error("Download already in progress for book ID: {0}")]
    AlreadyInProgress(String),

    #[error("Path error: {0}")]
    Path(#[from] PathError),

    #[error("Network request failed: {0}")]
    Network(String),

    #[error("HTTP status error ({status}): {message}")]
    HttpStatus { status: u16, message: String },

    #[error("EPUB validation failed: {0}")]
    Validation(String),

    #[error("Download was cancelled by user")]
    Cancelled,

    #[error("Filesystem I/O error: {0}")]
    Io(#[from] std::io::Error),
}
