import type { SettingsRepository } from '../../domain/database.js';
import type { SqlDatabase } from './sql-database.js';

interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

export class SqlSettingsRepository implements SettingsRepository {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  public async get(key: string): Promise<string | null> {
    const rows = await this.db.select<SettingRow[]>(
      'SELECT value FROM settings WHERE key = ? LIMIT 1;',
      [key],
    );
    if (!rows || rows.length === 0) {
      return null;
    }
    return rows[0].value;
  }

  public async getJSON<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (raw === null) {
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  public async set(key: string, value: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at;`,
      [key, value, now],
    );
  }

  public async setJSON<T>(key: string, value: T): Promise<void> {
    await this.set(key, JSON.stringify(value));
  }

  public async delete(key: string): Promise<void> {
    await this.db.execute('DELETE FROM settings WHERE key = ?;', [key]);
  }

  public async getAll(): Promise<Record<string, string>> {
    const rows = await this.db.select<SettingRow[]>(
      'SELECT key, value FROM settings;',
    );
    const result: Record<string, string> = {};
    for (const row of rows || []) {
      result[row.key] = row.value;
    }
    return result;
  }
}
