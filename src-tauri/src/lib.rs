use std::sync::Arc;
use tauri_plugin_sql::{Migration, MigrationKind};

pub mod commands;
pub mod downloads;
pub mod filesystem;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "001_initial_schema",
        sql: include_str!("../migrations/001_initial_schema.sql"),
        kind: MigrationKind::Up,
    }];

    let download_manager = Arc::new(downloads::DownloadManager::new());

    tauri::Builder::default()
        .manage(download_manager)
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:educk.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            greet,
            get_app_version,
            commands::download_book,
            commands::cancel_download,
            commands::get_download_status,
            commands::delete_book_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_migration_sql_contains_core_tables() {
        let sql = include_str!("../migrations/001_initial_schema.sql");
        assert!(!sql.is_empty());
        assert!(sql.contains("CREATE TABLE IF NOT EXISTS sources"));
        assert!(sql.contains("CREATE TABLE IF NOT EXISTS books"));
        assert!(sql.contains("CREATE TABLE IF NOT EXISTS reading_progress"));
        assert!(sql.contains("CREATE TABLE IF NOT EXISTS sync_state"));
        assert!(sql.contains("CREATE TABLE IF NOT EXISTS settings"));
        assert!(sql.contains("PRAGMA foreign_keys = ON;"));
    }
}

