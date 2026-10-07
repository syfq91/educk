import type { CatalogSource, SourceRepository, AuthType } from '../../domain/database.js';
import type { SqlDatabase } from './sql-database.js';

interface SourceRow {
  id: string;
  name: string;
  url: string;
  description: string | null;
  auth_type: string;
  auth_username: string | null;
  auth_password: string | null;
  auth_token: string | null;
  created_at: string;
  updated_at: string;
}

export class SqlSourceRepository implements SourceRepository {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  private mapRowToSource(row: SourceRow): CatalogSource {
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      description: row.description,
      username: row.auth_username,
      authType: (row.auth_type as AuthType) || 'none',
      authData: row.auth_token ?? row.auth_password ?? row.auth_username,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public async findById(id: string): Promise<CatalogSource | null> {
    const rows = await this.db.select<SourceRow[]>(
      'SELECT * FROM sources WHERE id = ? LIMIT 1;',
      [id],
    );
    if (!rows || rows.length === 0) {
      return null;
    }
    return this.mapRowToSource(rows[0]);
  }

  public async findByUrl(url: string): Promise<CatalogSource | null> {
    const rows = await this.db.select<SourceRow[]>(
      'SELECT * FROM sources WHERE url = ? LIMIT 1;',
      [url],
    );
    if (!rows || rows.length === 0) {
      return null;
    }
    return this.mapRowToSource(rows[0]);
  }

  public async findAll(): Promise<CatalogSource[]> {
    const rows = await this.db.select<SourceRow[]>(
      'SELECT * FROM sources ORDER BY name ASC;',
    );
    return (rows || []).map((row) => this.mapRowToSource(row));
  }

  public async insert(source: CatalogSource): Promise<void> {
    await this.db.execute(
      `INSERT INTO sources (id, name, url, description, auth_type, auth_username, auth_password, auth_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        source.id,
        source.name,
        source.url,
        source.description ?? null,
        source.authType,
        source.authType === 'basic' ? source.username ?? null : null,
        source.authType === 'basic' ? source.authData ?? null : null,
        source.authType === 'bearer' ? source.authData ?? null : null,
        source.createdAt,
        source.updatedAt,
      ],
    );
  }

  public async update(source: CatalogSource): Promise<void> {
    await this.db.execute(
      `UPDATE sources SET
        name = ?,
        url = ?,
        description = ?,
        auth_type = ?,
        auth_username = ?,
        auth_password = ?,
        auth_token = ?,
        updated_at = ?
       WHERE id = ?;`,
      [
        source.name,
        source.url,
        source.description ?? null,
        source.authType,
        source.authType === 'basic' ? source.username ?? null : null,
        source.authType === 'basic' ? source.authData ?? null : null,
        source.authType === 'bearer' ? source.authData ?? null : null,
        source.updatedAt,
        source.id,
      ],
    );
  }

  public async delete(id: string): Promise<void> {
    await this.db.execute('DELETE FROM sources WHERE id = ?;', [id]);
  }

  public async count(): Promise<number> {
    const rows = await this.db.select<{ count: number }[]>(
      'SELECT COUNT(*) as count FROM sources;',
    );
    return rows?.[0]?.count ?? 0;
  }
}
