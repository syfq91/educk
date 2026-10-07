use std::path::Path;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn read_book_file(app: AppHandle, path: String) -> Result<Vec<u8>, String> {
    // Resolve the path relative to app data directory if it's a relative path
    let file_path = Path::new(&path);

    let absolute_path = if file_path.is_relative() {
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))?;
        app_data.join(file_path)
    } else {
        file_path.to_path_buf()
    };

    // Security: ensure the path is within app data directory
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let canonical_app_data = app_data.canonicalize().map_err(|e| format!("Failed to canonicalize app data: {}", e))?;
    let canonical_path = absolute_path.canonicalize().map_err(|e| format!("File not found: {}", e))?;

    if !canonical_path.starts_with(&canonical_app_data) {
        return Err("Access denied: path outside app data directory".to_string());
    }

    tokio::fs::read(&canonical_path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))
}