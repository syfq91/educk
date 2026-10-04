import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseClient } from '../../src/services/database/database-client.js';
import { createMigratedTestDatabase, NodeSqliteDatabase } from '../helpers/test-database.js';

describe('DatabaseClient', () => {
  let testDb: NodeSqliteDatabase;

  beforeEach(() => {
    testDb = createMigratedTestDatabase();
    DatabaseClient.resetInstance();
  });

  afterEach(async () => {
    await testDb.close();
    DatabaseClient.resetInstance();
  });

  it('allows injecting a custom SqlDatabase and performs queries', async () => {
    const client = new DatabaseClient('sqlite:test.db', testDb);
    DatabaseClient.setInstance(client);

    const inst = DatabaseClient.getInstance();
    const rows = await inst.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='books';",
    );
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('books');

    // Execute query
    const insertResult = await inst.execute(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?);`,
      ['theme', 'dark', '2026-10-04T12:00:00Z'],
    );
    expect(insertResult.rowsAffected).toBe(1);

    const settingRows = await inst.select<{ value: string }[]>(
      'SELECT value FROM settings WHERE key = ?;',
      ['theme'],
    );
    expect(settingRows[0].value).toBe('dark');
  });

  it('supports close() and resets connection', async () => {
    const client = new DatabaseClient('sqlite:test.db', testDb);
    const closed = await client.close();
    expect(closed).toBe(true);
  });
});
