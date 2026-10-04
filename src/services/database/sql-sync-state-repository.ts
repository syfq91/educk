import type { SyncState, SyncStateRepository, SyncStatus } from '../../domain/database.js';
import type { SqlDatabase } from './sql-database.js';

interface SyncStateRow {
  book_id: string;
  local_version: number;
  remote_version: string | null;
  last_sync_at: string | null;
  sync_status: string;
}

export class SqlSyncStateRepository implements SyncStateRepository {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  private mapRowToSyncState(row: SyncStateRow): SyncState {
    return {
      bookId: row.book_id,
      localVersion: row.local_version,
      remoteVersion: row.remote_version,
      lastSyncAt: row.last_sync_at,
      syncStatus: (row.sync_status as SyncStatus) || 'idle',
    };
  }

  public async findByBookId(bookId: string): Promise<SyncState | null> {
    const rows = await this.db.select<SyncStateRow[]>(
      'SELECT * FROM sync_state WHERE book_id = ? LIMIT 1;',
      [bookId],
    );
    if (!rows || rows.length === 0) {
      return null;
    }
    return this.mapRowToSyncState(rows[0]);
  }

  public async upsert(state: SyncState): Promise<void> {
    await this.db.execute(
      `INSERT INTO sync_state (
        book_id, local_version, remote_version, last_sync_at, sync_status
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(book_id) DO UPDATE SET
        local_version = excluded.local_version,
        remote_version = excluded.remote_version,
        last_sync_at = excluded.last_sync_at,
        sync_status = excluded.sync_status;`,
      [
        state.bookId,
        state.localVersion,
        state.remoteVersion ?? null,
        state.lastSyncAt ?? null,
        state.syncStatus,
      ],
    );
  }

  public async findPendingSync(): Promise<SyncState[]> {
    const rows = await this.db.select<SyncStateRow[]>(
      "SELECT * FROM sync_state WHERE sync_status IN ('pending', 'conflict', 'error') ORDER BY last_sync_at ASC;",
    );
    return (rows || []).map((row) => this.mapRowToSyncState(row));
  }

  public async delete(bookId: string): Promise<void> {
    await this.db.execute('DELETE FROM sync_state WHERE book_id = ?;', [bookId]);
  }
}
