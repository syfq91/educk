import type { Book, BookQueryOptions, BookRepository } from '../../domain/database.js';
import type { SqlDatabase } from './sql-database.js';

interface BookRow {
  id: string;
  source_id: string | null;
  remote_id: string | null;
  title: string;
  subtitle: string | null;
  authors: string | null;
  description: string | null;
  cover_url: string | null;
  local_cover_path: string | null;
  acquisition_url: string;
  mime_type: string;
  local_path: string;
  file_size: number;
  downloaded_at: string;
  last_opened_at: string | null;
}

export class SqlBookRepository implements BookRepository {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  private mapRowToBook(row: BookRow): Book {
    return {
      id: row.id,
      sourceId: row.source_id,
      remoteId: row.remote_id,
      title: row.title,
      subtitle: row.subtitle,
      authors: row.authors,
      description: row.description,
      coverUrl: row.cover_url,
      localCoverPath: row.local_cover_path,
      acquisitionUrl: row.acquisition_url,
      mimeType: row.mime_type,
      localPath: row.local_path,
      fileSize: row.file_size,
      downloadedAt: row.downloaded_at,
      lastOpenedAt: row.last_opened_at,
    };
  }

  public async findById(id: string): Promise<Book | null> {
    const rows = await this.db.select<BookRow[]>(
      'SELECT * FROM books WHERE id = ? LIMIT 1;',
      [id],
    );
    if (!rows || rows.length === 0) {
      return null;
    }
    return this.mapRowToBook(rows[0]);
  }

  public async findByLocalPath(localPath: string): Promise<Book | null> {
    const rows = await this.db.select<BookRow[]>(
      'SELECT * FROM books WHERE local_path = ? LIMIT 1;',
      [localPath],
    );
    if (!rows || rows.length === 0) {
      return null;
    }
    return this.mapRowToBook(rows[0]);
  }

  public async findAll(options?: BookQueryOptions): Promise<Book[]> {
    let sql = 'SELECT * FROM books';
    const params: unknown[] = [];

    if (options?.sourceId) {
      sql += ' WHERE source_id = ?';
      params.push(options.sourceId);
    }

    const sortColumn =
      options?.sortBy === 'last_opened'
        ? 'last_opened_at'
        : options?.sortBy === 'title'
        ? 'title'
        : 'downloaded_at';
    const orderDirection = options?.order === 'asc' ? 'ASC' : 'DESC';

    sql += ` ORDER BY ${sortColumn} ${orderDirection}`;

    if (options?.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(options.limit);
      if (options?.offset !== undefined) {
        sql += ' OFFSET ?';
        params.push(options.offset);
      }
    }

    sql += ';';

    const rows = await this.db.select<BookRow[]>(sql, params);
    return (rows || []).map((row) => this.mapRowToBook(row));
  }

  public async insert(book: Book): Promise<void> {
    await this.db.execute(
      `INSERT INTO books (
        id, source_id, remote_id, title, subtitle, authors,
        description, cover_url, local_cover_path, acquisition_url,
        mime_type, local_path, file_size, downloaded_at, last_opened_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        book.id,
        book.sourceId ?? null,
        book.remoteId ?? null,
        book.title,
        book.subtitle ?? null,
        book.authors ?? null,
        book.description ?? null,
        book.coverUrl ?? null,
        book.localCoverPath ?? null,
        book.acquisitionUrl,
        book.mimeType,
        book.localPath,
        book.fileSize,
        book.downloadedAt,
        book.lastOpenedAt ?? null,
      ],
    );
  }

  public async update(book: Book): Promise<void> {
    await this.db.execute(
      `UPDATE books SET
        source_id = ?,
        remote_id = ?,
        title = ?,
        subtitle = ?,
        authors = ?,
        description = ?,
        cover_url = ?,
        local_cover_path = ?,
        acquisition_url = ?,
        mime_type = ?,
        local_path = ?,
        file_size = ?,
        downloaded_at = ?,
        last_opened_at = ?
      WHERE id = ?;`,
      [
        book.sourceId ?? null,
        book.remoteId ?? null,
        book.title,
        book.subtitle ?? null,
        book.authors ?? null,
        book.description ?? null,
        book.coverUrl ?? null,
        book.localCoverPath ?? null,
        book.acquisitionUrl,
        book.mimeType,
        book.localPath,
        book.fileSize,
        book.downloadedAt,
        book.lastOpenedAt ?? null,
        book.id,
      ],
    );
  }

  public async updateLastOpened(id: string, timestamp: string): Promise<void> {
    await this.db.execute(
      'UPDATE books SET last_opened_at = ? WHERE id = ?;',
      [timestamp, id],
    );
  }

  public async delete(id: string): Promise<void> {
    await this.db.execute('DELETE FROM books WHERE id = ?;', [id]);
  }

  public async count(): Promise<number> {
    const rows = await this.db.select<{ count: number }[]>(
      'SELECT COUNT(*) as count FROM books;',
    );
    return rows?.[0]?.count ?? 0;
  }
}
