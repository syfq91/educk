import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMigratedTestDatabase, NodeSqliteDatabase } from '../helpers/test-database.js';
import { SqlSyncStateRepository } from '../../src/services/database/sql-sync-state-repository.js';
import { SqlBookRepository } from '../../src/services/database/sql-book-repository.js';
import type { SyncState } from '../../src/domain/database.js';

describe('SqlSyncStateRepository', () => {
  let db: NodeSqliteDatabase;
  let repo: SqlSyncStateRepository;
  let bookRepo: SqlBookRepository;

  beforeEach(async () => {
    db = createMigratedTestDatabase();
    repo = new SqlSyncStateRepository(db);
    bookRepo = new SqlBookRepository(db);

    // Insert parent books
    await bookRepo.insert({
      id: 'book-1',
      title: 'Book 1',
      acquisitionUrl: 'http://example.com/1',
      mimeType: 'application/epub+zip',
      localPath: '/data/1.epub',
      fileSize: 1024,
      downloadedAt: '2026-10-04T00:00:00Z',
    });
    await bookRepo.insert({
      id: 'book-2',
      title: 'Book 2',
      acquisitionUrl: 'http://example.com/2',
      mimeType: 'application/epub+zip',
      localPath: '/data/2.epub',
      fileSize: 2048,
      downloadedAt: '2026-10-04T00:00:00Z',
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('upserts and retrieves sync state', async () => {
    const state: SyncState = {
      bookId: 'book-1',
      localVersion: 2,
      remoteVersion: 'etag-123',
      lastSyncAt: '2026-10-04T12:00:00Z',
      syncStatus: 'synced',
    };

    await repo.upsert(state);
    const found = await repo.findByBookId('book-1');
    expect(found).toEqual(state);
  });

  it('finds pending sync states', async () => {
    await repo.upsert({
      bookId: 'book-1',
      localVersion: 1,
      syncStatus: 'synced',
      lastSyncAt: '2026-10-04T12:00:00Z',
    });
    await repo.upsert({
      bookId: 'book-2',
      localVersion: 3,
      syncStatus: 'pending',
      lastSyncAt: '2026-10-04T12:05:00Z',
    });

    const pending = await repo.findPendingSync();
    expect(pending.length).toBe(1);
    expect(pending[0].bookId).toBe('book-2');
    expect(pending[0].syncStatus).toBe('pending');
  });

  it('deletes sync state', async () => {
    await repo.upsert({
      bookId: 'book-1',
      localVersion: 1,
      syncStatus: 'idle',
    });

    await repo.delete('book-1');
    expect(await repo.findByBookId('book-1')).toBeNull();
  });
});
