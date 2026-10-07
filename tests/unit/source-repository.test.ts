import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMigratedTestDatabase, NodeSqliteDatabase } from '../helpers/test-database.js';
import { SqlSourceRepository } from '../../src/services/database/sql-source-repository.js';
import type { CatalogSource } from '../../src/domain/database.js';

describe('SqlSourceRepository', () => {
  let db: NodeSqliteDatabase;
  let repo: SqlSourceRepository;

  const sampleSource: CatalogSource = {
    id: 'src-1',
    name: 'Standard Ebooks',
    url: 'https://standardebooks.org/opds',
    description: null,
    username: 'reader1',
    authType: 'basic',
    authData: 'secret-token',
    createdAt: '2026-10-04T00:00:00Z',
    updatedAt: '2026-10-04T00:00:00Z',
  };

  beforeEach(() => {
    db = createMigratedTestDatabase();
    repo = new SqlSourceRepository(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('inserts and finds source by id', async () => {
    await repo.insert(sampleSource);
    const found = await repo.findById('src-1');
    expect(found).toEqual(sampleSource);
  });

  it('finds source by url', async () => {
    await repo.insert(sampleSource);
    const found = await repo.findByUrl('https://standardebooks.org/opds');
    expect(found).toEqual(sampleSource);
  });

  it('returns null for non-existent source', async () => {
    expect(await repo.findById('nope')).toBeNull();
    expect(await repo.findByUrl('https://nope.com')).toBeNull();
  });

  it('updates a source', async () => {
    await repo.insert(sampleSource);
    const updated: CatalogSource = {
      ...sampleSource,
      name: 'Standard Ebooks (Global)',
      authType: 'bearer',
      authData: 'bearer-jwt',
      updatedAt: '2026-10-04T01:00:00Z',
    };
    await repo.update(updated);
    const found = await repo.findById('src-1');
    expect(found?.name).toBe('Standard Ebooks (Global)');
    expect(found?.authType).toBe('bearer');
    expect(found?.authData).toBe('bearer-jwt');
  });

  it('deletes a source', async () => {
    await repo.insert(sampleSource);
    expect(await repo.count()).toBe(1);
    await repo.delete('src-1');
    expect(await repo.count()).toBe(0);
    expect(await repo.findById('src-1')).toBeNull();
  });

  it('lists sources alphabetically', async () => {
    await repo.insert({
      ...sampleSource,
      id: 'z-src',
      name: 'Zulu Books',
      url: 'https://zulu.org/opds',
    });
    await repo.insert({
      ...sampleSource,
      id: 'a-src',
      name: 'Alpha Books',
      url: 'https://alpha.org/opds',
    });

    const sources = await repo.findAll();
    expect(sources.map((s) => s.name)).toEqual(['Alpha Books', 'Zulu Books']);
  });
});
