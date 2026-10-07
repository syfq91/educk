// Mock for node:sqlite - provides in-memory SQLite for tests
// This is a minimal mock to satisfy imports in test files

export interface Statement {
  bind(...params: unknown[]): Statement;
  step(): boolean;
  get(): Record<string, unknown> | null;
  all(): Record<string, unknown>[];
  finalize(): void;
}

export interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

export function open(_filename: string): Database {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  let lastInsertRowid = 0;

  function exec(sql: string): void {
    // Very basic SQL execution for test purposes
    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith("CREATE TABLE")) {
      // Extract table name
      const match = sql.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/i);
      if (match) {
        tables.set(match[1], new Map());
      }
    } else if (trimmed.startsWith("INSERT")) {
      // Simulate insert
      lastInsertRowid++;
    } else if (trimmed.startsWith("UPDATE") || trimmed.startsWith("DELETE")) {
      // Simulate update/delete
    }
  }

  function prepare(sql: string): Statement {
    const trimmed = sql.trim().toUpperCase();
    const isSelect = trimmed.startsWith("SELECT");
    const isInsert = trimmed.startsWith("INSERT");
    let stepCalled = false;
    let result: Record<string, unknown> | null = null;

    return {
      bind(..._params: unknown[]) {
        return this;
      },
      step() {
        if (stepCalled) return false;
        stepCalled = true;
        
        if (isSelect) {
          // Return mock row for SELECT queries
          if (sql.includes("sqlite_master")) {
            result = { name: "test_table", sql: "CREATE TABLE test_table (id INTEGER PRIMARY KEY)" };
            return true;
          }
          if (sql.includes("PRAGMA")) {
            result = { busy_timeout: 5000, foreign_keys: 1 };
            return true;
          }
          if (sql.includes("sources") || sql.includes("books") || sql.includes("reading_progress")) {
            result = { id: "test-id", name: "Test", url: "https://test.com" };
            return true;
          }
          if (sql.includes("COUNT(*)")) {
            result = { count: 0 };
            return true;
          }
        } else if (isInsert) {
          lastInsertRowid++;
          result = { lastInsertRowid };
          return true;
        }
        return false;
      },
      get() {
        return result;
      },
      all() {
        return result ? [result] : [];
      },
      finalize() {},
    };
  }

  return {
    exec,
    prepare,
    close() {},
  };
}