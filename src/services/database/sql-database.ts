/**
 * Low-level SQL Database interface.
 * Decouples repositories from specific SQLite driver implementations
 * (@tauri-apps/plugin-sql in production, in-memory SQLite in unit tests).
 */

export interface QueryResult {
  rowsAffected: number;
  lastInsertId?: number;
}

export interface SqlDatabase {
  execute(query: string, bindValues?: unknown[]): Promise<QueryResult>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  close(): Promise<boolean>;
}
