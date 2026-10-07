/**
 * Domain models and repository interfaces for SQLite persistence.
 * Strict separation: UI components interact only with repositories, never raw SQL.
 */

export type AuthType = 'none' | 'basic' | 'bearer';

export interface CatalogSource {
  id: string;
  name: string;
  url: string;
  description?: string | null;
  username?: string | null;
  authType: AuthType;
  authData?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Book {
  id: string;
  sourceId?: string | null;
  remoteId?: string | null;
  title: string;
  subtitle?: string | null;
  authors?: string | null;
  description?: string | null;
  coverUrl?: string | null;
  localCoverPath?: string | null;
  acquisitionUrl: string;
  mimeType: string;
  localPath: string;
  fileSize: number;
  downloadedAt: string;
  lastOpenedAt?: string | null;
}

export interface ReadingProgress {
  bookId: string;
  progression: number; // 0.0 to 1.0
  locator: string;     // EPUB CFI or JSON locator
  href?: string | null;
  chapterTitle?: string | null;
  modifiedAt: string;  // ISO 8601 UTC
  syncedAt?: string | null;
}

export type SyncStatus = 'idle' | 'pending' | 'syncing' | 'synced' | 'conflict' | 'failed' | 'error';

export interface SyncState {
  bookId: string;
  localVersion: number;
  remoteVersion?: string | null;
  lastSyncAt?: string | null;
  syncStatus: SyncStatus;
}

export interface AppSetting {
  key: string;
  value: string;
  updatedAt: string;
}

export interface BookQueryOptions {
  sortBy?: 'last_opened' | 'downloaded_at' | 'title';
  order?: 'asc' | 'desc';
  sourceId?: string;
  limit?: number;
  offset?: number;
}

export interface BookRepository {
  findById(id: string): Promise<Book | null>;
  findByLocalPath(localPath: string): Promise<Book | null>;
  findAll(options?: BookQueryOptions): Promise<Book[]>;
  insert(book: Book): Promise<void>;
  update(book: Book): Promise<void>;
  updateLastOpened(id: string, timestamp: string): Promise<void>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}

export interface SourceRepository {
  findById(id: string): Promise<CatalogSource | null>;
  findByUrl(url: string): Promise<CatalogSource | null>;
  findAll(): Promise<CatalogSource[]>;
  insert(source: CatalogSource): Promise<void>;
  update(source: CatalogSource): Promise<void>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}

export interface ProgressRepository {
  findByBookId(bookId: string): Promise<ReadingProgress | null>;
  upsert(progress: ReadingProgress): Promise<void>;
  delete(bookId: string): Promise<void>;
}

export interface SyncStateRepository {
  findByBookId(bookId: string): Promise<SyncState | null>;
  upsert(state: SyncState): Promise<void>;
  findPendingSync(): Promise<SyncState[]>;
  delete(bookId: string): Promise<void>;
}

export interface SettingsRepository {
  get(key: string): Promise<string | null>;
  getJSON<T>(key: string): Promise<T | null>;
  set(key: string, value: string): Promise<void>;
  setJSON<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  getAll(): Promise<Record<string, string>>;
}
