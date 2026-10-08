use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::downloads::models::{DownloadProgressPayload, DownloadRequest, DownloadResult};
use crate::downloads::DownloadManager;
use crate::filesystem::paths::{cleanup_all_orphan_parts, delete_book_dir};

#[tauri::command]
pub async fn download_book(
    app: AppHandle,
    state: State<'_, Arc<DownloadManager>>,
    request: DownloadRequest,
) -> Result<DownloadResult, String> {
    state
        .start_download(app, request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_download(
    state: State<'_, Arc<DownloadManager>>,
    book_id: String,
) -> Result<bool, String> {
    Ok(state.cancel_download(&book_id).await)
}

#[tauri::command]
pub async fn get_download_status(
    state: State<'_, Arc<DownloadManager>>,
    book_id: String,
) -> Result<Option<DownloadProgressPayload>, String> {
    Ok(state.get_status(&book_id).await)
}

#[tauri::command]
pub async fn delete_book_file(app: AppHandle, book_id: String) -> Result<bool, String> {
    delete_book_dir(&app, &book_id)
        .await
        .map(|_| true)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cleanup_orphan_downloads(app: AppHandle) -> Result<usize, String> {
    cleanup_all_orphan_parts(&app)
        .await
        .map_err(|e| e.to_string())
}
