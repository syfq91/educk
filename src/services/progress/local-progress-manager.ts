/**
 * LocalProgressManager
 *
 * Implements debounced local reading progress tracking (Milestone M10).
 * Decouples Reader UI events from SQLite disk I/O, preventing disk thrashing
 * during rapid page turns, and flushes immediately on lifecycle events.
 */

import type { ProgressRepository, BookRepository, ReadingProgress } from "../../domain/database.ts";
import type {
  ProgressManager,
  ProgressManagerConfig,
  ProgressUpdate,
} from "../../domain/progress.ts";
import { validateProgressUpdate } from "../../domain/progress.ts";

const DEFAULT_DEBOUNCE_MS = 1000;

export class LocalProgressManager implements ProgressManager {
  private progressRepo: ProgressRepository;
  private bookRepo?: BookRepository;
  private debounceMs: number;
  private config: ProgressManagerConfig;
  private pendingUpdates: Map<string, ProgressUpdate> = new Map();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlightFlush: Promise<void> | null = null;

  constructor(
    progressRepo: ProgressRepository,
    bookRepo?: BookRepository,
    config?: ProgressManagerConfig,
  ) {
    this.progressRepo = progressRepo;
    this.bookRepo = bookRepo;
    this.config = config ?? {};
    this.debounceMs = this.config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /**
   * Enqueues a reading position update and starts the debounce timer.
   * Coalesces multiple rapid page turns into the latest position.
   */
  public recordProgress(rawUpdate: ProgressUpdate): void {
    const validated = validateProgressUpdate(rawUpdate);
    if (!validated) {
      console.warn("Invalid progress update ignored:", rawUpdate);
      return;
    }

    this.pendingUpdates.set(validated.bookId, validated);

    // Reset debounce timer
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush();
    }, this.debounceMs);
  }

  /**
   * Immediately commits all pending progress updates to SQLite.
   * Cancels any pending timer and returns a Promise that completes when writes are saved.
   */
  public async flush(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.pendingUpdates.size === 0) {
      // If a flush is currently in flight, wait for it to complete
      if (this.inFlightFlush) {
        await this.inFlightFlush;
      }
      return;
    }

    // Wait for any existing in-flight flush before starting a new batch
    if (this.inFlightFlush) {
      await this.inFlightFlush;
    }

    this.inFlightFlush = this.executeFlushBatch();
    try {
      await this.inFlightFlush;
    } finally {
      this.inFlightFlush = null;
    }
  }

  private async executeFlushBatch(): Promise<void> {
    const updatesToCommit = Array.from(this.pendingUpdates.values());
    this.pendingUpdates.clear();

    for (const update of updatesToCommit) {
      try {
        const timestamp = update.modifiedAt || new Date().toISOString();
        const record: ReadingProgress = {
          bookId: update.bookId,
          progression: update.progression,
          locator: update.locator,
          href: update.href ?? null,
          chapterTitle: update.chapterTitle ?? null,
          modifiedAt: timestamp,
        };

        // 1. Upsert reading progress in SQLite
        await this.progressRepo.upsert(record);

        // 2. Synchronize book last_opened_at in SQLite if bookRepo is provided
        if (this.bookRepo) {
          try {
            await this.bookRepo.updateLastOpened(update.bookId, timestamp);
          } catch (bookErr) {
            console.warn(`Could not update lastOpenedAt for book ${update.bookId}:`, bookErr);
          }
        }

        this.config.onProgressSaved?.(update);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(`Failed to commit reading progress for book ${update.bookId}:`, error);
        this.config.onError?.(error);
      }
    }
  }

  /**
   * Retrieves the current reading progress for a book.
   * Checks in-memory pending updates first for immediate consistency, then queries SQLite.
   */
  public async getProgress(bookId: string): Promise<ReadingProgress | null> {
    const pending = this.pendingUpdates.get(bookId);
    if (pending) {
      return {
        bookId: pending.bookId,
        progression: pending.progression,
        locator: pending.locator,
        href: pending.href ?? null,
        chapterTitle: pending.chapterTitle ?? null,
        modifiedAt: pending.modifiedAt || new Date().toISOString(),
      };
    }

    return this.progressRepo.findByBookId(bookId);
  }

  /**
   * Checks if there are unflushed pending progress updates.
   */
  public hasPendingProgress(bookId?: string): boolean {
    if (bookId) {
      return this.pendingUpdates.has(bookId);
    }
    return this.pendingUpdates.size > 0;
  }

  /**
   * Clears pending in-memory updates.
   */
  public clearPending(bookId?: string): void {
    if (bookId) {
      this.pendingUpdates.delete(bookId);
    } else {
      this.pendingUpdates.clear();
    }

    if (this.pendingUpdates.size === 0 && this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Tears down any active timers and cleans up state.
   */
  public destroy(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingUpdates.clear();
    this.inFlightFlush = null;
  }
}
