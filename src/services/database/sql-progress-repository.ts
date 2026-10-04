import type { ReadingProgress, ProgressRepository } from '../../domain/database.js';
import type { SqlDatabase } from './sql-database.js';

interface ProgressRow {
  book_id: string;
  progression: number;
  locator: string;
  href: string | null;
  chapter_title: string | null;
  modified_at: string;
  synced_at: string | null;
}

export class SqlProgressRepository implements ProgressRepository {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  private mapRowToProgress(row: ProgressRow): ReadingProgress {
    return {
      bookId: row.book_id,
      progression: row.progression,
      locator: row.locator,
      href: row.href,
      chapterTitle: row.chapter_title,
      modifiedAt: row.modified_at,
      syncedAt: row.synced_at,
    };
  }

  public async findByBookId(bookId: string): Promise<ReadingProgress | null> {
    const rows = await this.db.select<ProgressRow[]>(
      'SELECT * FROM reading_progress WHERE book_id = ? LIMIT 1;',
      [bookId],
    );
    if (!rows || rows.length === 0) {
      return null;
    }
    return this.mapRowToProgress(rows[0]);
  }

  public async upsert(progress: ReadingProgress): Promise<void> {
    await this.db.execute(
      `INSERT INTO reading_progress (
        book_id, progression, locator, href, chapter_title, modified_at, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id) DO UPDATE SET
        progression = excluded.progression,
        locator = excluded.locator,
        href = excluded.href,
        chapter_title = excluded.chapter_title,
        modified_at = excluded.modified_at,
        synced_at = excluded.synced_at;`,
      [
        progress.bookId,
        progress.progression,
        progress.locator,
        progress.href ?? null,
        progress.chapterTitle ?? null,
        progress.modifiedAt,
        progress.syncedAt ?? null,
      ],
    );
  }

  public async delete(bookId: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM reading_progress WHERE book_id = ?;',
      [bookId],
    );
  }
}
