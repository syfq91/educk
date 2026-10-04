export * from './sql-database.js';
export * from './database-client.js';
export * from './sql-book-repository.js';
export * from './sql-source-repository.js';
export * from './sql-progress-repository.js';
export * from './sql-sync-state-repository.js';
export * from './sql-settings-repository.js';

import type { SqlDatabase } from './sql-database.js';
import { SqlBookRepository } from './sql-book-repository.js';
import { SqlSourceRepository } from './sql-source-repository.js';
import { SqlProgressRepository } from './sql-progress-repository.js';
import { SqlSyncStateRepository } from './sql-sync-state-repository.js';
import { SqlSettingsRepository } from './sql-settings-repository.js';

export interface DatabaseRepositories {
  books: SqlBookRepository;
  sources: SqlSourceRepository;
  progress: SqlProgressRepository;
  syncState: SqlSyncStateRepository;
  settings: SqlSettingsRepository;
}

export function createRepositories(db: SqlDatabase): DatabaseRepositories {
  return {
    books: new SqlBookRepository(db),
    sources: new SqlSourceRepository(db),
    progress: new SqlProgressRepository(db),
    syncState: new SqlSyncStateRepository(db),
    settings: new SqlSettingsRepository(db),
  };
}
