import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMigratedTestDatabase, NodeSqliteDatabase } from '../helpers/test-database.js';
import { SqlSettingsRepository } from '../../src/services/database/sql-settings-repository.js';

describe('SqlSettingsRepository', () => {
  let db: NodeSqliteDatabase;
  let repo: SqlSettingsRepository;

  beforeEach(() => {
    db = createMigratedTestDatabase();
    repo = new SqlSettingsRepository(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('stores and retrieves string settings', async () => {
    await repo.set('reader.theme', 'sepia');
    const val = await repo.get('reader.theme');
    expect(val).toBe('sepia');
  });

  it('updates existing setting on conflict', async () => {
    await repo.set('reader.fontSize', '18');
    await repo.set('reader.fontSize', '22');
    const val = await repo.get('reader.fontSize');
    expect(val).toBe('22');
  });

  it('returns null for non-existent setting', async () => {
    const val = await repo.get('unknown.key');
    expect(val).toBeNull();
  });

  it('stores and retrieves JSON objects', async () => {
    interface ReaderPreferences {
      theme: string;
      fontSize: number;
      fontFamily: string;
      lineSpacing: number;
      margin: string;
    }

    const prefs: ReaderPreferences = {
      theme: 'dark',
      fontSize: 20,
      fontFamily: 'serif',
      lineSpacing: 1.6,
      margin: 'wide',
    };

    await repo.setJSON('reader.preferences', prefs);
    const retrieved = await repo.getJSON<ReaderPreferences>('reader.preferences');
    expect(retrieved).toEqual(prefs);
  });

  it('returns null for malformed or missing JSON setting', async () => {
    expect(await repo.getJSON('missing')).toBeNull();

    await repo.set('corrupted.json', 'invalid-json-{[');
    expect(await repo.getJSON('corrupted.json')).toBeNull();
  });

  it('deletes a setting', async () => {
    await repo.set('temp', '123');
    await repo.delete('temp');
    expect(await repo.get('temp')).toBeNull();
  });

  it('retrieves all settings as key-value map', async () => {
    await repo.set('k1', 'v1');
    await repo.set('k2', 'v2');
    const all = await repo.getAll();
    expect(all).toEqual({ k1: 'v1', k2: 'v2' });
  });
});
