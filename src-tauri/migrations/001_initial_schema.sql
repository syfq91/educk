PRAGMA foreign_keys = ON;

-- Catalogs & OPDS feeds
CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    username TEXT,
    auth_type TEXT NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'basic', 'bearer')),
    auth_data TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Downloaded & acquired books
CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
    remote_id TEXT,
    title TEXT NOT NULL,
    subtitle TEXT,
    authors TEXT,
    description TEXT,
    cover_url TEXT,
    local_cover_path TEXT,
    acquisition_url TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    local_path TEXT NOT NULL UNIQUE,
    file_size INTEGER NOT NULL,
    downloaded_at TEXT NOT NULL,
    last_opened_at TEXT
);

-- Discrete local reading progress
CREATE TABLE IF NOT EXISTS reading_progress (
    book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    progression REAL NOT NULL DEFAULT 0.0,
    locator TEXT NOT NULL,
    href TEXT,
    chapter_title TEXT,
    modified_at TEXT NOT NULL,
    synced_at TEXT
);

-- Remote synchronization state (OPDS Progression 1.0)
CREATE TABLE IF NOT EXISTS sync_state (
    book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    local_version INTEGER NOT NULL DEFAULT 1,
    remote_version TEXT,
    last_sync_at TEXT,
    sync_status TEXT NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'pending', 'syncing', 'synced', 'conflict', 'failed', 'error'))
);

-- Application & Reader Settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Indices for query performance
CREATE INDEX IF NOT EXISTS idx_books_source_id ON books(source_id);
CREATE INDEX IF NOT EXISTS idx_books_last_opened ON books(last_opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_reading_progress_modified ON reading_progress(modified_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_state_status ON sync_state(sync_status);
