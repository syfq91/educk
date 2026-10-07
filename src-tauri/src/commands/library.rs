use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_sql::SqlitePool;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Catalog {
    pub id: String,
    pub name: String,
    pub url: String,
    pub description: Option<String>,
    pub auth_type: Option<String>,
    pub auth_username: Option<String>,
    pub auth_password: Option<String>,
    pub auth_token: Option<String>,
}

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

#[tauri::command]
pub async fn get_catalogs(pool: State<'_, Arc<SqlitePool>>) -> Result<Vec<Catalog>, String> {
    let rows = sqlx::query_as!(
        Catalog,
        r#"
        SELECT id, name, url, description, 
               auth_type, auth_username, auth_password, auth_token
        FROM sources
        ORDER BY name ASC
        "#
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to fetch catalogs: {}", e))?;

    Ok(rows)
}

#[tauri::command]
pub async fn add_catalog(pool: State<'_, Arc<SqlitePool>>, catalog: Catalog) -> Result<(), String> {
    sqlx::query!(
        r#"
        INSERT INTO sources (id, name, url, description, auth_type, auth_username, auth_password, auth_token, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        "#,
        catalog.id,
        catalog.name,
        catalog.url,
        catalog.description,
        catalog.auth_type.unwrap_or("none"),
        catalog.auth_username,
        catalog.auth_password,
        catalog.auth_token,
    )
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Failed to add catalog: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn delete_catalog(pool: State<'_, Arc<SqlitePool>>, catalog_id: String) -> Result<(), String> {
    sqlx::query!("DELETE FROM sources WHERE id = ?", catalog_id)
        .execute(pool.inner())
        .await
        .map_err(|e| format!("Failed to delete catalog: {}", e))?;

    Ok(())
}