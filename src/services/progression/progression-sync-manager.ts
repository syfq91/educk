/**
 * ProgressionSyncManager (Concern 6)
 *
 * Implements OPDS Progression 1.0 synchronization manager.
 * Orchestrates offline-first background reading progress synchronization:
 * - Maintains SQLite sync_state queue for offline resilience
 * - Linear conflict resolution based on modified timestamps
 * - Cold-open pull vs. active-session conflict prompt
 * - Device tracking and credential forwarding
 */

import type {
  BookRepository,
  ProgressRepository,
  ReadingProgress,
  SettingsRepository,
  SourceRepository,
  SyncStateRepository,
} from "../../domain/database.ts";
import type { OPDSCatalogAuth } from "../../domain/opds.ts";
import type {
  IProgressionClient,
  IProgressionSyncManager,
  ProgressionConflict,
  ProgressionSyncCallbacks,
  ProgressionSyncResult,
  RemoteProgressionPayload,
  SyncBookOptions,
} from "../../domain/progression.ts";
import { ProgressionConflictError } from "./progression-client.ts";

export interface ProgressionSyncManagerOptions {
  progressRepo: ProgressRepository;
  syncStateRepo: SyncStateRepository;
  settingsRepo: SettingsRepository;
  bookRepo?: BookRepository;
  sourceRepo?: SourceRepository;
  client: IProgressionClient;
  callbacks?: ProgressionSyncCallbacks;
}

interface PendingConflictRecord {
  conflict: ProgressionConflict;
  remotePayload: RemoteProgressionPayload;
  localProgress: ReadingProgress;
}

export class ProgressionSyncManager implements IProgressionSyncManager {
  private progressRepo: ProgressRepository;
  private syncStateRepo: SyncStateRepository;
  private settingsRepo: SettingsRepository;
  private bookRepo?: BookRepository;
  private sourceRepo?: SourceRepository;
  private client: IProgressionClient;
  private callbacks?: ProgressionSyncCallbacks;

  private pendingConflicts = new Map<string, PendingConflictRecord>();
  private activeSyncPromises = new Map<string, Promise<ProgressionSyncResult>>();

  constructor(options: ProgressionSyncManagerOptions) {
    this.progressRepo = options.progressRepo;
    this.syncStateRepo = options.syncStateRepo;
    this.settingsRepo = options.settingsRepo;
    this.bookRepo = options.bookRepo;
    this.sourceRepo = options.sourceRepo;
    this.client = options.client;
    this.callbacks = options.callbacks;
  }

  public async getDeviceId(): Promise<string> {
    const existing = await this.settingsRepo.get("progression.device_id");
    if (existing && existing.trim()) {
      return existing;
    }

    const randomSuffix =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);

    const newId = `educk-android-${randomSuffix}`;
    await this.settingsRepo.set("progression.device_id", newId);

    if (
      typeof (this.client as unknown as { setDeviceId?: (id: string) => void }).setDeviceId ===
      "function"
    ) {
      (this.client as unknown as { setDeviceId: (id: string) => void }).setDeviceId(newId);
    }

    return newId;
  }

  public async registerProgressionUrl(bookId: string, url: string): Promise<void> {
    await this.settingsRepo.set(`progression.url.${bookId}`, url);

    const existing = await this.syncStateRepo.findByBookId(bookId);
    if (!existing) {
      await this.syncStateRepo.upsert({
        bookId,
        localVersion: 1,
        remoteVersion: null,
        lastSyncAt: null,
        syncStatus: "idle",
      });
    }
  }

  public async getProgressionUrl(bookId: string): Promise<string | null> {
    return await this.settingsRepo.get(`progression.url.${bookId}`);
  }

  public async syncBook(bookId: string, options: SyncBookOptions = {}): Promise<ProgressionSyncResult> {
    // Deduplicate in-flight syncs for the same book
    const inFlight = this.activeSyncPromises.get(bookId);
    if (inFlight) {
      return inFlight;
    }

    const syncPromise = this.performSyncBook(bookId, options).finally(() => {
      this.activeSyncPromises.delete(bookId);
    });

    this.activeSyncPromises.set(bookId, syncPromise);
    return syncPromise;
  }

  private async performSyncBook(
    bookId: string,
    options: SyncBookOptions,
  ): Promise<ProgressionSyncResult> {
    const url = await this.getProgressionUrl(bookId);
    if (!url) {
      return { bookId, action: "skipped" };
    }

    let auth: OPDSCatalogAuth | undefined;
    let bookTitle: string | undefined;

    if (this.bookRepo) {
      try {
        const book = await this.bookRepo.findById(bookId);
        if (book) {
          bookTitle = book.title;
          if (book.sourceId && this.sourceRepo) {
            const source = await this.sourceRepo.findById(book.sourceId);
            if (source && source.authType !== "none") {
              if (source.authType === "basic" && source.username) {
                auth = {
                  type: "basic",
                  username: source.username,
                  password: source.authData || "",
                };
              } else if (source.authType === "bearer" && source.authData) {
                auth = {
                  type: "bearer",
                  token: source.authData,
                };
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[ProgressionSyncManager] Error looking up book/source metadata for ${bookId}:`, err);
      }
    }

    const currentSyncState = await this.syncStateRepo.findByBookId(bookId);
    const localVersion = currentSyncState?.localVersion ?? 1;

    // Transition to syncing state
    await this.syncStateRepo.upsert({
      bookId,
      localVersion,
      remoteVersion: currentSyncState?.remoteVersion ?? null,
      lastSyncAt: currentSyncState?.lastSyncAt ?? null,
      syncStatus: "syncing",
    });

    // 1. Fetch remote progression
    let remotePayload: RemoteProgressionPayload | null;
    try {
      remotePayload = await this.client.getProgression(url, auth);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      // Mark as pending retry in offline queue
      await this.syncStateRepo.upsert({
        bookId,
        localVersion,
        remoteVersion: currentSyncState?.remoteVersion ?? null,
        lastSyncAt: currentSyncState?.lastSyncAt ?? null,
        syncStatus: "pending",
      });

      this.callbacks?.onError?.(error, bookId);
      const res: ProgressionSyncResult = {
        bookId,
        action: "error",
        error: error.message,
      };
      this.callbacks?.onSyncComplete?.(res);
      return res;
    }

    // 2. Fetch local progress
    const localProgress = await this.progressRepo.findByBookId(bookId);

    // 3. Decision Matrix
    // Case A: No remote progress found
    if (!remotePayload) {
      if (localProgress && (localProgress.progression > 0 || localProgress.locator)) {
        return await this.pushLocalProgress(bookId, url, localProgress, localVersion, auth);
      } else {
        await this.syncStateRepo.upsert({
          bookId,
          localVersion,
          remoteVersion: null,
          lastSyncAt: new Date().toISOString(),
          syncStatus: "synced",
        });
        const res: ProgressionSyncResult = { bookId, action: "skipped" };
        this.callbacks?.onSyncComplete?.(res);
        return res;
      }
    }

    // Case B: Remote progress exists, but no local progress exists
    if (!localProgress) {
      return await this.pullRemoteProgress(bookId, remotePayload, localVersion);
    }

    // Case C: Both local and remote progress exist - compare modified timestamps
    const localTime = new Date(localProgress.modifiedAt).getTime();
    const remoteTime = new Date(remotePayload.modified).getTime();
    const timeDiffMs = Math.abs(localTime - remoteTime);

    // Subcase C1: Timestamps are identical or identical progress
    if (timeDiffMs < 1000 || Math.abs(localProgress.progression - remotePayload.locator.locations.totalProgression) < 0.0001) {
      const now = new Date().toISOString();
      await this.syncStateRepo.upsert({
        bookId,
        localVersion,
        remoteVersion: remotePayload.modified,
        lastSyncAt: now,
        syncStatus: "synced",
      });
      const res: ProgressionSyncResult = { bookId, action: "skipped" };
      this.callbacks?.onSyncComplete?.(res);
      return res;
    }

    // Subcase C2: Local is strictly newer than remote
    if (localTime > remoteTime) {
      return await this.pushLocalProgress(bookId, url, localProgress, localVersion, auth);
    }

    // Subcase C3: Remote is strictly newer than local
    if (options.isColdOpen) {
      // On cold open: silently apply newer remote progress
      return await this.pullRemoteProgress(bookId, remotePayload, localVersion);
    }

    // Remote is newer during an active reading session -> Conflict!
    return await this.recordConflict(bookId, localProgress, remotePayload, localVersion, bookTitle);
  }

  private async recordConflict(
    bookId: string,
    localProgress: ReadingProgress,
    remotePayload: RemoteProgressionPayload,
    localVersion: number,
    bookTitle?: string,
  ): Promise<ProgressionSyncResult> {
    const conflict: ProgressionConflict = {
      bookId,
      localProgression: localProgress.progression,
      localModifiedAt: localProgress.modifiedAt,
      localLocator: localProgress.locator,
      localTitle: bookTitle,
      remoteProgression: remotePayload.locator.locations.totalProgression,
      remoteModifiedAt: remotePayload.modified,
      remoteLocator: remotePayload.locator.locations.cfi || remotePayload.locator.href || "",
      remoteTitle: remotePayload.locator.title || bookTitle,
    };

    this.pendingConflicts.set(bookId, {
      conflict,
      remotePayload,
      localProgress,
    });

    await this.syncStateRepo.upsert({
      bookId,
      localVersion,
      remoteVersion: remotePayload.modified,
      lastSyncAt: new Date().toISOString(),
      syncStatus: "conflict",
    });

    this.callbacks?.onConflictPrompt?.(conflict);
    const res: ProgressionSyncResult = {
      bookId,
      action: "conflict",
      conflict,
    };
    this.callbacks?.onSyncComplete?.(res);
    return res;
  }

  private async pushLocalProgress(
    bookId: string,
    url: string,
    localProgress: ReadingProgress,
    currentVersion: number,
    auth?: OPDSCatalogAuth,
  ): Promise<ProgressionSyncResult> {
    const deviceId = await this.getDeviceId();
    const payload: RemoteProgressionPayload = {
      modified: localProgress.modifiedAt,
      device: { id: deviceId, name: "educk Reader" },
      progression: localProgress.progression,
      title: localProgress.chapterTitle ?? undefined,
      references: localProgress.href ? [localProgress.href] : undefined,
      locator: {
        href: localProgress.href ?? undefined,
        title: localProgress.chapterTitle ?? undefined,
        locations: {
          cfi: localProgress.locator.startsWith("epubcfi(") ? localProgress.locator : undefined,
          progression: localProgress.progression,
          totalProgression: localProgress.progression,
        },
      },
    };

    try {
      await this.client.putProgression(url, payload, auth);
      const now = new Date().toISOString();

      await this.syncStateRepo.upsert({
        bookId,
        localVersion: currentVersion + 1,
        remoteVersion: localProgress.modifiedAt,
        lastSyncAt: now,
        syncStatus: "synced",
      });

      await this.progressRepo.upsert({
        ...localProgress,
        syncedAt: now,
      });

      const res: ProgressionSyncResult = { bookId, action: "pushed" };
      this.callbacks?.onSyncComplete?.(res);
      return res;
    } catch (err) {
      if (err instanceof ProgressionConflictError) {
        // BookFlow / OPDS 409 Conflict: Remote progression has a newer timestamp
        try {
          const remote = await this.client.getProgression(url, auth);
          if (remote) {
            return await this.recordConflict(bookId, localProgress, remote, currentVersion);
          }
        } catch (fetchErr) {
          console.warn(`[ProgressionSyncManager] Error fetching remote progression on 409 conflict:`, fetchErr);
        }
      }

      const error = err instanceof Error ? err : new Error(String(err));
      await this.syncStateRepo.upsert({
        bookId,
        localVersion: currentVersion,
        remoteVersion: null,
        lastSyncAt: null,
        syncStatus: "pending",
      });

      this.callbacks?.onError?.(error, bookId);
      const res: ProgressionSyncResult = {
        bookId,
        action: "error",
        error: error.message,
      };
      this.callbacks?.onSyncComplete?.(res);
      return res;
    }
  }

  private async pullRemoteProgress(
    bookId: string,
    remotePayload: RemoteProgressionPayload,
    currentVersion: number,
  ): Promise<ProgressionSyncResult> {
    const now = new Date().toISOString();
    const locator =
      remotePayload.locator.locations.cfi ||
      remotePayload.locator.href ||
      "start";

    const progression =
      typeof remotePayload.locator.locations.totalProgression === "number"
        ? remotePayload.locator.locations.totalProgression
        : remotePayload.locator.locations.progression ?? 0.0;

    await this.progressRepo.upsert({
      bookId,
      progression,
      locator,
      href: remotePayload.locator.href ?? null,
      chapterTitle: remotePayload.locator.title ?? null,
      modifiedAt: remotePayload.modified,
      syncedAt: now,
    });

    await this.syncStateRepo.upsert({
      bookId,
      localVersion: currentVersion + 1,
      remoteVersion: remotePayload.modified,
      lastSyncAt: now,
      syncStatus: "synced",
    });

    const res: ProgressionSyncResult = { bookId, action: "pulled" };
    this.callbacks?.onSyncComplete?.(res);
    return res;
  }

  public async resolveConflict(
    bookId: string,
    resolution: "keep_local" | "apply_remote",
  ): Promise<ProgressionSyncResult> {
    const pending = this.pendingConflicts.get(bookId);
    this.pendingConflicts.delete(bookId);

    const url = await this.getProgressionUrl(bookId);
    if (!url) {
      return { bookId, action: "skipped" };
    }

    const currentSync = await this.syncStateRepo.findByBookId(bookId);
    const currentVersion = currentSync?.localVersion ?? 1;

    let auth: OPDSCatalogAuth | undefined;
    if (this.bookRepo) {
      const book = await this.bookRepo.findById(bookId);
      if (book?.sourceId && this.sourceRepo) {
        const source = await this.sourceRepo.findById(book.sourceId);
        if (source && source.authType !== "none") {
          if (source.authType === "basic" && source.username) {
            auth = { type: "basic", username: source.username, password: source.authData || "" };
          } else if (source.authType === "bearer" && source.authData) {
            auth = { type: "bearer", token: source.authData };
          }
        }
      }
    }

    if (resolution === "keep_local") {
      let localProgress = pending?.localProgress;
      if (!localProgress) {
        localProgress = (await this.progressRepo.findByBookId(bookId)) ?? undefined;
      }

      if (!localProgress) {
        return { bookId, action: "skipped" };
      }

      // Bump modifiedAt to ensure it is newer than the remote timestamp
      const updatedLocal: ReadingProgress = {
        ...localProgress,
        modifiedAt: new Date().toISOString(),
      };
      await this.progressRepo.upsert(updatedLocal);

      return await this.pushLocalProgress(bookId, url, updatedLocal, currentVersion, auth);
    } else {
      // apply_remote
      let remotePayload = pending?.remotePayload;
      if (!remotePayload) {
        remotePayload = (await this.client.getProgression(url, auth)) ?? undefined;
      }

      if (!remotePayload) {
        return { bookId, action: "skipped" };
      }

      return await this.pullRemoteProgress(bookId, remotePayload, currentVersion);
    }
  }

  public async syncQueue(): Promise<ProgressionSyncResult[]> {
    const pendingStates = await this.syncStateRepo.findPendingSync();
    const results: ProgressionSyncResult[] = [];

    for (const state of pendingStates) {
      try {
        const res = await this.syncBook(state.bookId);
        results.push(res);
      } catch (err) {
        results.push({
          bookId: state.bookId,
          action: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  public destroy(): void {
    this.pendingConflicts.clear();
    this.activeSyncPromises.clear();
  }
}

export function createProgressionSyncManager(
  options: ProgressionSyncManagerOptions,
): ProgressionSyncManager {
  return new ProgressionSyncManager(options);
}
