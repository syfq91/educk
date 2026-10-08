/**
 * Progression Service Module
 *
 * Re-exports domain models, HTTP client, and synchronization manager for
 * OPDS Progression 1.0 (Concern 6).
 */

export * from "../../domain/progression.ts";
export {
  ProgressionClient,
  ProgressionNetworkError,
  ProgressionAuthError,
  ProgressionConflictError,
  isValidProgressionPayload,
  normalizeProgressionPayload,
  createProgressionClient,
} from "./progression-client.ts";
export {
  ProgressionSyncManager,
  createProgressionSyncManager,
  type ProgressionSyncManagerOptions,
} from "./progression-sync-manager.ts";
