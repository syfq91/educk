/**
 * Domain types, interfaces, and validation utilities for Reading Progress (Concern 5).
 * Decouples reader navigation from persistence and synchronization layers.
 */

import type { ReadingProgress } from "./database.ts";

export interface ProgressUpdate {
  bookId: string;
  progression: number;       // 0.0 to 1.0
  locator: string;           // EPUB CFI or locator string
  href?: string | null;      // Spine item href
  chapterTitle?: string | null;
  modifiedAt?: string;       // ISO 8601 timestamp
}

export interface ProgressManagerConfig {
  debounceMs?: number;       // Debounce interval in ms (default 1000)
  onProgressSaved?: (update: ProgressUpdate) => void;
  onError?: (error: Error) => void;
}

export interface ProgressManager {
  recordProgress(update: ProgressUpdate): void;
  flush(): Promise<void>;
  getProgress(bookId: string): Promise<ReadingProgress | null>;
  hasPendingProgress(bookId?: string): boolean;
  clearPending(bookId?: string): void;
  destroy(): void;
}

/**
 * Sanitizes and clamps progression value strictly between 0.0 and 1.0.
 * Handles NaN, undefined, null, and non-numeric inputs safely.
 */
export function sanitizeProgression(value: unknown): number {
  if (typeof value !== "number" || isNaN(value) || !isFinite(value)) {
    return 0.0;
  }
  return Math.max(0.0, Math.min(1.0, value));
}

/**
 * Validates whether a given string is a syntactically valid EPUB Canonical Fragment Identifier (CFI).
 * Standard CFIs follow `epubcfi(/6/...)` syntax.
 */
export function isValidCfi(locator: unknown): boolean {
  if (typeof locator !== "string") return false;
  const trimmed = locator.trim();
  if (!trimmed) return false;
  return trimmed.startsWith("epubcfi(") && trimmed.endsWith(")");
}

/**
 * Defensive validator that parses and cleanses a ProgressUpdate object.
 * Returns null if the payload is missing mandatory fields (like bookId or locator).
 */
export function validateProgressUpdate(raw: unknown): ProgressUpdate | null {
  if (!raw || typeof raw !== "object") return null;

  const item = raw as Record<string, unknown>;
  const bookId = typeof item.bookId === "string" ? item.bookId.trim() : "";
  if (!bookId) return null;

  const locator = typeof item.locator === "string" ? item.locator.trim() : "";
  if (!locator) return null;

  const progression = sanitizeProgression(item.progression);
  const href = typeof item.href === "string" ? item.href.trim() : null;
  const chapterTitle = typeof item.chapterTitle === "string" ? item.chapterTitle.trim() : null;
  const modifiedAt = typeof item.modifiedAt === "string" && !isNaN(Date.parse(item.modifiedAt))
    ? item.modifiedAt
    : new Date().toISOString();

  return {
    bookId,
    progression,
    locator,
    href: href || null,
    chapterTitle: chapterTitle || null,
    modifiedAt,
  };
}
