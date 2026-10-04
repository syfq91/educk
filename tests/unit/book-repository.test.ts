import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMigratedTestDatabase, NodeSqliteDatabase } from '../helpers/test-database.js';
import { SqlBookRepository } from '../../src/services/database/sql-book-repository.js';
import type { Book } from '../../src/domain/database.js';

describe('SqlBookRepository', () => {
  let db: NodeSqliteDatabase;
  let repo: SqlBookRepository;

  const sampleBook: Book = {
    id: 'book-123',
    sourceId: null,
    remoteId: 'remote-456',
    title: 'Moby Dick',
    subtitle: 'The Whale',
    authors: 'Herman Melville',
    description: 'A classic nautical epic.',
    coverUrl: 'https://example.com/moby.jpg',
    localCoverPath: '/data/covers/moby.jpg',
    acquisitionUrl: 'https://example.com/moby.epub',
    mimeType: 'application/epub+zip',
    localPath: '/data/books/book-123/book.epub',
    fileSize: 1048576,
    downloadedAt: '2026-10-04T10:00:00Z',
    lastOpenedAt: null,
  };

  beforeEach(() => {
    db = createMigratedTestDatabase();
    repo = new SqlBookRepository(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('inserts and retrieves a book by id', async () => {
    await repo.insert(sampleBook);
    const found = await repo.findById('book-123');
    expect(found).toEqual(sampleBook);
  });

  it('returns null when finding non-existent id', async () => {
    const found = await repo.findById('non-existent');
    expect(found).toBeNull();
  });

  it('finds book by local path', async () => {
    await repo.insert(sampleBook);
    const found = await repo.findByLocalPath('/data/books/book-123/book.epub');
    expect(found).toEqual(sampleBook);
  });

  it('updates a book', async () => {
    await repo.insert(sampleBook);
    const updated: Book = {
      ...sampleBook,
      title: 'Moby Dick (Updated Edition)',
      fileSize: 2048000,
    };
    await repo.update(updated);
    const found = await repo.findById('book-123');
    expect(found?.title).toBe('Moby Dick (Updated Edition)');
    expect(found?.fileSize).toBe(2048000);
  });

  it('updates lastOpenedAt timestamp', async () => {
    await repo.insert(sampleBook);
    const ts = '2026-10-04T12:30:00Z';
    await repo.updateLastOpened('book-123', ts);
    const found = await repo.findById('book-123');
    expect(found?.lastOpenedAt).toBe(ts);
  });

  it('deletes a book', async () => {
    await repo.insert(sampleBook);
    expect(await repo.count()).toBe(1);
    await repo.delete('book-123');
    expect(await repo.count()).toBe(0);
    expect(await repo.findById('book-123')).toBeNull();
  });

  it('lists and sorts books', async () => {
    const bookA: Book = {
      ...sampleBook,
      id: 'book-a',
      title: 'Alpha Book',
      localPath: '/data/a.epub',
      downloadedAt: '2026-10-01T00:00:00Z',
      lastOpenedAt: '2026-10-04T08:00:00Z',
    };
    const bookB: Book = {
      ...sampleBook,
      id: 'book-b',
      title: 'Beta Book',
      localPath: '/data/b.epub',
      downloadedAt: '2026-10-02T00:00:00Z',
      lastOpenedAt: '2026-10-04T09:00:00Z',
    };

    await repo.insert(bookA);
    await repo.insert(bookB);

    const sortedByTitle = await repo.findAll({ sortBy: 'title', order: 'asc' });
    expect(sortedByTitle.map((b) => b.id)).toEqual(['book-a', 'book-b']);

    const sortedByDownloadedDesc = await repo.findAll({ sortBy: 'downloaded_at', order: 'desc' });
    expect(sortedByDownloadedDesc.map((b) => b.id)).toEqual(['book-b', 'book-a']);

    const sortedByOpenedDesc = await repo.findAll({ sortBy: 'last_opened', order: 'desc' });
    expect(sortedByOpenedDesc.map((b) => b.id)).toEqual(['book-b', 'book-a']);
  });
});
