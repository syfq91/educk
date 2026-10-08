/**
 * OPDS Progression 1.0 Domain Models & Contracts (Concern 6).
 *
 * Implements Readium-compatible progression payload schemas, device identifier
 * management, conflict detection models, and client/sync-manager interfaces.
 */

import type { OPDSCatalogAuth } from "./opds.ts";

export interface RemoteProgressionLocations {
  cfi?: string;
  progression?: number;      // 0.0 to 1.0 within chapter/spine item
  totalProgression: number;  // 0.0 to 1.0 across whole publication
}

export interface RemoteProgressionLocator {
  href?: string;
  type?: string;
  title?: string;
  locations: RemoteProgressionLocations;
}

export interface RemoteProgressionDevice {
  id: string;
  name?: string;
}

export interface RemoteProgressionPayload {
  modified: string;          // ISO 8601 UTC timestamp
  device: string | RemoteProgressionDevice; // Device identifier string or { id, name }
  progression?: number;      // 0.0 to 1.0 (BookFlow / top-level OPDS Progression 1.0)
  title?: string;            // Current position label / chapter title
  references?: string[];     // Content document references (e.g. ["chapter1.html"])
  locator: RemoteProgressionLocator;
}

export interface ProgressionConflict {
  bookId: string;
  localProgression: number;
  localModifiedAt: string;
  localLocator: string;
  localTitle?: string | null;
  remoteProgression: number;
  remoteModifiedAt: string;
  remoteLocator: string;
  remoteTitle?: string | null;
}

export type SyncAction = "pushed" | "pulled" | "conflict" | "queued" | "skipped" | "error";

export interface ProgressionSyncResult {
  bookId: string;
  action: SyncAction;
  error?: string;
  conflict?: ProgressionConflict;
}

export interface ProgressionClientConfig {
  deviceId?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  userAgent?: string;
}

export interface IProgressionClient {
  getProgression(url: string, auth?: OPDSCatalogAuth): Promise<RemoteProgressionPayload | null>;
  putProgression(url: string, payload: RemoteProgressionPayload, auth?: OPDSCatalogAuth): Promise<boolean>;
}

export interface SyncBookOptions {
  isColdOpen?: boolean;
  isSessionActive?: boolean;
}

export interface ProgressionSyncCallbacks {
  onConflictPrompt?: (conflict: ProgressionConflict) => void;
  onSyncComplete?: (result: ProgressionSyncResult) => void;
  onError?: (error: Error, bookId?: string) => void;
}

export interface IProgressionSyncManager {
  getDeviceId(): Promise<string>;
  registerProgressionUrl(bookId: string, url: string): Promise<void>;
  getProgressionUrl(bookId: string): Promise<string | null>;
  syncBook(bookId: string, options?: SyncBookOptions): Promise<ProgressionSyncResult>;
  syncQueue(): Promise<ProgressionSyncResult[]>;
  resolveConflict(bookId: string, resolution: "keep_local" | "apply_remote"): Promise<ProgressionSyncResult>;
  destroy(): void;
}
