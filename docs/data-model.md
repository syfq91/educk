# Data Model & SQLite Schema — educk

## Overview
SQLite serves as the single source of truth for all local state, library metadata, download records, and reading progress.

---

## Database Schema (v1)

```sql
-- Catalogs & OPDS feeds
CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,               -- UUIDv4
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    username TEXT,
    auth_type TEXT NOT NULL DEFAULT 'none', -- 'none', 'basic', 'bearer'
    auth_data TEXT,                   -- token or encrypted credential
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Downloaded & acquired books
CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,               -- UUIDv4
    source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
    remote_id TEXT,                   -- Remote Atom/OPDS entry ID
    title TEXT NOT NULL,
    subtitle TEXT,
    authors TEXT,                     -- Comma-separated or JSON array of author names
    description TEXT,
    cover_url TEXT,
    local_cover_path TEXT,            -- Cached local cover image path
    acquisition_url TEXT NOT NULL,
    mime_type TEXT NOT NULL,          -- e.g. 'application/epub+zip'
    local_path TEXT NOT NULL UNIQUE,  -- Relative or absolute path in appData
    file_size INTEGER NOT NULL,
    downloaded_at TEXT NOT NULL,
    last_opened_at TEXT
);

-- Discrete local reading progress
CREATE TABLE IF NOT EXISTS reading_progress (
    book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    progression REAL NOT NULL DEFAULT 0.0, -- Normalized value [0.0 - 1.0]
    locator TEXT NOT NULL,                 -- Full JSON Readium/Foliate locator object
    href TEXT,                             -- Spine item path (e.g. 'text/ch1.xhtml')
    chapter_title TEXT,
    modified_at TEXT NOT NULL,             -- ISO 8601 UTC timestamp of reading activity
    synced_at TEXT                         -- Timestamp when last synced to server
);

-- Remote synchronization state (OPDS Progression 1.0)
CREATE TABLE IF NOT EXISTS sync_state (
    book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    local_version INTEGER NOT NULL DEFAULT 1,
    remote_version TEXT,
    last_sync_at TEXT,
    sync_status TEXT NOT NULL DEFAULT 'synced' -- 'synced', 'pending', 'conflict', 'failed'
);

-- Application & Reader Settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

---

## Migration Architecture
1. **Versioned Migrations**:
   - Stored under `src-tauri/migrations/`.
   - Migration tracker table `_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)`.
2. **Immutability Rule**:
   - Once a migration is committed, it is NEVER modified or deleted.
   - Schema alterations must be performed via subsequent migrations (`002_...sql`).
3. **Domain Models**:
   - Frontend and Rust share strictly typed equivalents matching this schema.
   - UI components interact with repositories (`BookRepository`, `ProgressRepository`), never with raw SQL.
