import type { SqlDatabase, QueryResult } from './sql-database.js';

export class DatabaseClient implements SqlDatabase {
  private static instance: DatabaseClient | null = null;
  private db: SqlDatabase | null = null;
  private connectionPromise: Promise<SqlDatabase> | null = null;
  private readonly connectionString: string;

  constructor(connectionString = 'sqlite:educk.db', customDb?: SqlDatabase) {
    this.connectionString = connectionString;
    if (customDb) {
      this.db = customDb;
    }
  }

  public static getInstance(): DatabaseClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new DatabaseClient();
    }
    return DatabaseClient.instance;
  }

  public static setInstance(client: DatabaseClient): void {
    DatabaseClient.instance = client;
  }

  public static resetInstance(): void {
    DatabaseClient.instance = null;
  }

  public async getDatabase(): Promise<SqlDatabase> {
    if (this.db) {
      return this.db;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = (async () => {
      try {
        // Dynamically import @tauri-apps/plugin-sql
        const { default: Database } = await import('@tauri-apps/plugin-sql');
        const tauriDb = await Database.load(this.connectionString);
        
        // Wrap tauriDb into our SqlDatabase interface
        const wrappedDb: SqlDatabase = {
          execute: async (query: string, bindValues?: unknown[]) => {
            const res = await tauriDb.execute(query, bindValues);
            return {
              rowsAffected: res.rowsAffected,
              lastInsertId: res.lastInsertId,
            };
          },
          select: async <T>(query: string, bindValues?: unknown[]) => {
            return tauriDb.select<T>(query, bindValues);
          },
          close: async () => {
            return tauriDb.close();
          },
        };

        // Enable foreign keys and WAL mode on connection for crash safety
        await wrappedDb.execute('PRAGMA foreign_keys = ON;');
        await wrappedDb.execute('PRAGMA journal_mode = WAL;');
        await wrappedDb.execute('PRAGMA synchronous = NORMAL;');
        this.db = wrappedDb;
        return wrappedDb;
      } catch (err) {
        throw new Error(
          `Failed to initialize SQLite connection [${this.connectionString}]: ${
            err instanceof Error ? err.message : String(err)
          }`,
          { cause: err },
        );
      } finally {
        this.connectionPromise = null;
      }
    })();

    return this.connectionPromise;
  }

  public async execute(query: string, bindValues?: unknown[]): Promise<QueryResult> {
    const db = await this.getDatabase();
    return db.execute(query, bindValues);
  }

  public async select<T>(query: string, bindValues?: unknown[]): Promise<T> {
    const db = await this.getDatabase();
    return db.select<T>(query, bindValues);
  }

  public async close(): Promise<boolean> {
    if (this.db) {
      const res = await this.db.close();
      this.db = null;
      return res;
    }
    return true;
  }
}
