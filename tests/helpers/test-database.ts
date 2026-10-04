import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SqlDatabase, QueryResult } from '../../src/services/database/sql-database.js';

export class NodeSqliteDatabase implements SqlDatabase {
  private db: DatabaseSync | null;

  constructor(inMemory = true) {
    this.db = new DatabaseSync(inMemory ? ':memory:' : 'test.db');
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  public exec(sql: string): void {
    if (!this.db) {
      throw new Error('Database closed');
    }
    this.db.exec(sql);
  }

  public async execute(query: string, bindValues: unknown[] = []): Promise<QueryResult> {
    if (!this.db) {
      throw new Error('Database closed');
    }
    const stmt = this.db.prepare(query);
    // Convert undefined to null for sqlite binding
    const sanitized = bindValues.map((v) => (v === undefined ? null : v));
    const result = stmt.run(...(sanitized as (string | number | bigint | null | Uint8Array)[]));
    return {
      rowsAffected: Number(result.changes),
      lastInsertId: Number(result.lastInsertRowid),
    };
  }

  public async select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
    if (!this.db) {
      throw new Error('Database closed');
    }
    const stmt = this.db.prepare(query);
    const sanitized = bindValues.map((v) => (v === undefined ? null : v));
    const rows = stmt.all(...(sanitized as (string | number | bigint | null | Uint8Array)[]));
    return rows as unknown as T;
  }

  public async close(): Promise<boolean> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    return true;
  }
}

export function createMigratedTestDatabase(): NodeSqliteDatabase {
  const db = new NodeSqliteDatabase(true);
  const migrationPath = resolve(process.cwd(), 'src-tauri/migrations/001_initial_schema.sql');
  const sql = readFileSync(migrationPath, 'utf-8');
  db.exec(sql);
  return db;
}
