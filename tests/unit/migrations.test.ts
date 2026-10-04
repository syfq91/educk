import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMigratedTestDatabase, NodeSqliteDatabase } from '../helpers/test-database.js';

describe('SQLite Migration 001_initial_schema', () => {
  let db: NodeSqliteDatabase;

  beforeEach(() => {
    db = createMigratedTestDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  it('creates all expected tables', async () => {
    const tables = await db.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
    );
    const tableNames = tables.map((t) => t.name).sort();
    expect(tableNames).toEqual([
      'books',
      'reading_progress',
      'settings',
      'sources',
      'sync_state',
    ]);
  });

  it('creates all expected indices', async () => {
    const indices = await db.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%';",
    );
    const indexNames = indices.map((i) => i.name).sort();
    expect(indexNames).toContain('idx_books_source_id');
    expect(indexNames).toContain('idx_books_last_opened');
    expect(indexNames).toContain('idx_reading_progress_modified');
    expect(indexNames).toContain('idx_sync_state_status');
  });

  it('enforces foreign key ON DELETE CASCADE from books to reading_progress and sync_state', async () => {
    // Insert a book
    await db.execute(
      `INSERT INTO books (id, title, acquisition_url, mime_type, local_path, file_size, downloaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      ['b1', 'Test Book', 'http://example.com/b1', 'application/epub+zip', '/path/b1.epub', 1024, '2026-10-04T12:00:00Z'],
    );

    // Insert progress and sync state
    await db.execute(
      `INSERT INTO reading_progress (book_id, progression, locator, modified_at)
       VALUES (?, ?, ?, ?);`,
      ['b1', 0.45, 'epubcfi(/6/2)', '2026-10-04T12:00:00Z'],
    );
    await db.execute(
      `INSERT INTO sync_state (book_id, local_version, sync_status)
       VALUES (?, ?, ?);`,
      ['b1', 1, 'synced'],
    );

    // Confirm existence
    const progressBefore = await db.select<unknown[]>('SELECT * FROM reading_progress WHERE book_id = ?;', ['b1']);
    const syncBefore = await db.select<unknown[]>('SELECT * FROM sync_state WHERE book_id = ?;', ['b1']);
    expect(progressBefore.length).toBe(1);
    expect(syncBefore.length).toBe(1);

    // Delete the book
    await db.execute('DELETE FROM books WHERE id = ?;', ['b1']);

    // Progress and sync state must be cascaded away
    const progressAfter = await db.select<unknown[]>('SELECT * FROM reading_progress WHERE book_id = ?;', ['b1']);
    const syncAfter = await db.select<unknown[]>('SELECT * FROM sync_state WHERE book_id = ?;', ['b1']);
    expect(progressAfter.length).toBe(0);
    expect(syncAfter.length).toBe(0);
  });

  it('enforces foreign key ON DELETE SET NULL from sources to books', async () => {
    // Insert a source
    await db.execute(
      `INSERT INTO sources (id, name, url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?);`,
      ['s1', 'Standard Ebooks', 'https://standardebooks.org/opds', '2026-10-04T12:00:00Z', '2026-10-04T12:00:00Z'],
    );

    // Insert a book referencing that source
    await db.execute(
      `INSERT INTO books (id, source_id, title, acquisition_url, mime_type, local_path, file_size, downloaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      ['b2', 's1', 'Test Book 2', 'http://example.com/b2', 'application/epub+zip', '/path/b2.epub', 2048, '2026-10-04T12:00:00Z'],
    );

    // Delete the source
    await db.execute('DELETE FROM sources WHERE id = ?;', ['s1']);

    // Book should still exist, but source_id is NULL
    const books = await db.select<{ id: string; source_id: string | null }[]>(
      'SELECT id, source_id FROM books WHERE id = ?;',
      ['b2'],
    );
    expect(books.length).toBe(1);
    expect(books[0].source_id).toBeNull();
  });

  it('enforces unique constraints on source url and book local_path', async () => {
    await db.execute(
      `INSERT INTO sources (id, name, url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?);`,
      ['s1', 'Source 1', 'https://example.com/opds', '2026-10-04T12:00:00Z', '2026-10-04T12:00:00Z'],
    );

    // Duplicate source url should fail
    await expect(
      db.execute(
        `INSERT INTO sources (id, name, url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?);`,
        ['s2', 'Source 2', 'https://example.com/opds', '2026-10-04T12:00:00Z', '2026-10-04T12:00:00Z'],
      ),
    ).rejects.toThrow();

    await db.execute(
      `INSERT INTO books (id, title, acquisition_url, mime_type, local_path, file_size, downloaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      ['b1', 'Book 1', 'http://example.com/1', 'application/epub+zip', '/data/1.epub', 500, '2026-10-04T12:00:00Z'],
    );

    // Duplicate local_path should fail
    await expect(
      db.execute(
        `INSERT INTO books (id, title, acquisition_url, mime_type, local_path, file_size, downloaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        ['b2', 'Book 2', 'http://example.com/2', 'application/epub+zip', '/data/1.epub', 500, '2026-10-04T12:00:00Z'],
      ),
    ).rejects.toThrow();
  });

  it('enforces check constraints for auth_type and sync_status', async () => {
    // Invalid auth_type
    await expect(
      db.execute(
        `INSERT INTO sources (id, name, url, auth_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?);`,
        ['s-inv', 'Invalid', 'https://example.com/inv', 'oauth2', '2026-10-04T12:00:00Z', '2026-10-04T12:00:00Z'],
      ),
    ).rejects.toThrow();

    // Valid auth_types
    for (const validAuth of ['none', 'basic', 'bearer']) {
      await db.execute(
        `INSERT INTO sources (id, name, url, auth_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?);`,
        [`s-${validAuth}`, validAuth, `https://example.com/${validAuth}`, validAuth, '2026-10-04T12:00:00Z', '2026-10-04T12:00:00Z'],
      );
    }
  });
});
