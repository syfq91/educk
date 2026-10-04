import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMigratedTestDatabase, NodeSqliteDatabase } from '../helpers/test-database.js';
import { SqlProgressRepository } from '../../src/services/database/sql-progress-repository.js';
import { SqlBookRepository } from '../../src/services/database/sql-book-repository.js';
import type { ReadingProgress } from '../../src/domain/database.js';

describe('SqlProgressRepository', () => {
  let db: NodeSqliteDatabase;
  let repo: SqlProgressRepository;
  let bookRepo: SqlBookRepository;

  beforeEach(async () => {
    db = createMigratedTestDatabase();
    repo = new SqlProgressRepository(db);
    bookRepo = new SqlBookRepository(db);

    // Parent book must exist for foreign key
    await bookRepo.insert({
      id: 'book-1',
      title: 'Sample',
      acquisitionUrl: 'http://example.com/1',
      mimeType: 'application/epub+zip',
      localPath: '/data/1.epub',
      fileSize: 1024,
      downloadedAt: '2026-10-04T00:00:00Z',
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('upserts and retrieves reading progress', async () => {
    const progress: ReadingProgress = {
      bookId: 'book-1',
      progression: 0.255,
      locator: 'epubcfi(/6/4[ch1]!/4/2/10)',
      href: 'EPUB/ch1.xhtml',
      chapterTitle: 'Chapter 1: The Pond',
      modifiedAt: '2026-10-04T12:00:00Z',
      syncedAt: null,
    };

    await repo.upsert(progress);
    const found = await repo.findByBookId('book-1');
    expect(found).toEqual(progress);
  });

  it('updates existing reading progress on conflict', async () => {
    await repo.upsert({
      bookId: 'book-1',
      progression: 0.1,
      locator: 'epubcfi(/6/2)',
      modifiedAt: '2026-10-04T12:00:00Z',
    });

    const updated: ReadingProgress = {
      bookId: 'book-1',
      progression: 0.65,
      locator: 'epubcfi(/6/8)',
      href: 'EPUB/ch3.xhtml',
      chapterTitle: 'Chapter 3',
      modifiedAt: '2026-10-04T12:15:00Z',
      syncedAt: '2026-10-04T12:16:00Z',
    };

    await repo.upsert(updated);
    const found = await repo.findByBookId('book-1');
    expect(found).toEqual(updated);
  });

  it('deletes reading progress', async () => {
    await repo.upsert({
      bookId: 'book-1',
      progression: 0.5,
      locator: 'epubcfi(/6/6)',
      modifiedAt: '2026-10-04T12:00:00Z',
    });

    await repo.delete('book-1');
    expect(await repo.findByBookId('book-1')).toBeNull();
  });

  it('returns null for unread book', async () => {
    const found = await repo.findByBookId('non-existent');
    expect(found).toBeNull();
  });
});
