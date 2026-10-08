import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { LocalProgressManager } from "../../src/services/progress/local-progress-manager.ts";
import {
  sanitizeProgression,
  isValidCfi,
  validateProgressUpdate,
} from "../../src/domain/progress.ts";
import type { ProgressRepository, BookRepository, ReadingProgress, Book } from "../../src/domain/database.ts";

describe("Milestone M10: Reading Progress Domain & LocalProgressManager", () => {
  describe("Domain Validation Utilities", () => {
    it("sanitizes progression values strictly between 0.0 and 1.0", () => {
      expect(sanitizeProgression(0.5)).toBe(0.5);
      expect(sanitizeProgression(0)).toBe(0);
      expect(sanitizeProgression(1)).toBe(1);
      expect(sanitizeProgression(-0.25)).toBe(0);
      expect(sanitizeProgression(1.75)).toBe(1);
      expect(sanitizeProgression(NaN)).toBe(0);
      expect(sanitizeProgression(Infinity)).toBe(0);
      expect(sanitizeProgression(-Infinity)).toBe(0);
      expect(sanitizeProgression(null)).toBe(0);
      expect(sanitizeProgression(undefined)).toBe(0);
      expect(sanitizeProgression("0.5")).toBe(0);
    });

    it("validates EPUB CFI locator strings", () => {
      expect(isValidCfi("epubcfi(/6/4[ch1]!/4/2/10)")).toBe(true);
      expect(isValidCfi("epubcfi(/6/2!/4)")).toBe(true);
      expect(isValidCfi("")).toBe(false);
      expect(isValidCfi("ch1.xhtml")).toBe(false);
      expect(isValidCfi("chapter-1")).toBe(false);
      expect(isValidCfi(null)).toBe(false);
      expect(isValidCfi(undefined)).toBe(false);
    });

    it("validates and cleanses ProgressUpdate objects", () => {
      const valid = validateProgressUpdate({
        bookId: "book-123",
        progression: 0.42,
        locator: "epubcfi(/6/12)",
        href: "text/ch2.xhtml",
        chapterTitle: "Chapter 2",
        modifiedAt: "2026-10-08T00:00:00Z",
      });

      expect(valid).not.toBeNull();
      expect(valid?.bookId).toBe("book-123");
      expect(valid?.progression).toBe(0.42);
      expect(valid?.locator).toBe("epubcfi(/6/12)");
      expect(valid?.href).toBe("text/ch2.xhtml");
      expect(valid?.chapterTitle).toBe("Chapter 2");
      expect(valid?.modifiedAt).toBe("2026-10-08T00:00:00Z");

      // Rejects missing bookId or locator
      expect(validateProgressUpdate({ bookId: "", locator: "epubcfi(/6/2)" })).toBeNull();
      expect(validateProgressUpdate({ bookId: "book-1", locator: "" })).toBeNull();
      expect(validateProgressUpdate(null)).toBeNull();
    });
  });

  describe("LocalProgressManager", () => {
    let storedProgress: Map<string, ReadingProgress>;
    let storedBooks: Map<string, Book>;
    let mockProgressRepo: ProgressRepository;
    let mockBookRepo: BookRepository;
    let manager: LocalProgressManager;

    beforeEach(() => {
      vi.useFakeTimers();
      storedProgress = new Map();
      storedBooks = new Map();

      mockProgressRepo = {
        findByBookId: vi.fn(async (bookId: string) => storedProgress.get(bookId) ?? null),
        upsert: vi.fn(async (record: ReadingProgress) => {
          storedProgress.set(record.bookId, record);
        }),
        delete: vi.fn(async (bookId: string) => {
          storedProgress.delete(bookId);
        }),
      };

      mockBookRepo = {
        findById: vi.fn(async (id: string) => storedBooks.get(id) ?? null),
        findByLocalPath: vi.fn(async () => null),
        findAll: vi.fn(async () => Array.from(storedBooks.values())),
        insert: vi.fn(async (b: Book) => { storedBooks.set(b.id, b); }),
        update: vi.fn(async () => undefined),
        updateLastOpened: vi.fn(async (id: string, timestamp: string) => {
          const b = storedBooks.get(id);
          if (b) b.lastOpenedAt = timestamp;
        }),
        delete: vi.fn(async (id: string) => { storedBooks.delete(id); }),
        count: vi.fn(async () => storedBooks.size),
      };

      manager = new LocalProgressManager(mockProgressRepo, mockBookRepo, { debounceMs: 1000 });
    });

    afterEach(() => {
      manager.destroy();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("debounces rapid page turns and writes once after debounce window", async () => {
      // Simulate 5 rapid page turns in 500ms
      manager.recordProgress({
        bookId: "book-1",
        progression: 0.1,
        locator: "epubcfi(/6/2)",
      });
      vi.advanceTimersByTime(100);

      manager.recordProgress({
        bookId: "book-1",
        progression: 0.12,
        locator: "epubcfi(/6/4)",
      });
      vi.advanceTimersByTime(100);

      manager.recordProgress({
        bookId: "book-1",
        progression: 0.15,
        locator: "epubcfi(/6/6)",
      });
      vi.advanceTimersByTime(100);

      manager.recordProgress({
        bookId: "book-1",
        progression: 0.18,
        locator: "epubcfi(/6/8)",
      });
      vi.advanceTimersByTime(100);

      manager.recordProgress({
        bookId: "book-1",
        progression: 0.20,
        locator: "epubcfi(/6/10)",
        chapterTitle: "Chapter 1",
      });

      // No SQLite writes yet
      expect(mockProgressRepo.upsert).not.toHaveBeenCalled();
      expect(manager.hasPendingProgress("book-1")).toBe(true);

      // Advance debounce window to completion (1000ms from last record)
      await vi.advanceTimersByTimeAsync(1000);

      // Exactly ONE upsert was made with the latest position
      expect(mockProgressRepo.upsert).toHaveBeenCalledTimes(1);
      expect(mockProgressRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          bookId: "book-1",
          progression: 0.20,
          locator: "epubcfi(/6/10)",
          chapterTitle: "Chapter 1",
        }),
      );
      expect(mockBookRepo.updateLastOpened).toHaveBeenCalledTimes(1);
      expect(manager.hasPendingProgress("book-1")).toBe(false);
    });

    it("flushes immediately when flush() is invoked without waiting for timer", async () => {
      manager.recordProgress({
        bookId: "book-1",
        progression: 0.5,
        locator: "epubcfi(/6/20)",
      });

      expect(mockProgressRepo.upsert).not.toHaveBeenCalled();

      // Flush explicitly (e.g. reader close or app backgrounding)
      await manager.flush();

      expect(mockProgressRepo.upsert).toHaveBeenCalledTimes(1);
      expect(mockProgressRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          bookId: "book-1",
          progression: 0.5,
          locator: "epubcfi(/6/20)",
        }),
      );
      expect(manager.hasPendingProgress("book-1")).toBe(false);

      // Advancing timer does not trigger redundant write
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockProgressRepo.upsert).toHaveBeenCalledTimes(1);
    });

    it("returns pending in-memory progress from getProgress() before database commit", async () => {
      manager.recordProgress({
        bookId: "book-1",
        progression: 0.75,
        locator: "epubcfi(/6/30)",
        chapterTitle: "Chapter 5",
      });

      // Not yet saved to SQLite
      expect(storedProgress.has("book-1")).toBe(false);

      // getProgress retrieves the fresh pending state immediately
      const active = await manager.getProgress("book-1");
      expect(active).not.toBeNull();
      expect(active?.progression).toBe(0.75);
      expect(active?.locator).toBe("epubcfi(/6/30)");
      expect(active?.chapterTitle).toBe("Chapter 5");
    });

    it("handles tracking multiple books concurrently", async () => {
      manager.recordProgress({
        bookId: "book-1",
        progression: 0.3,
        locator: "epubcfi(/6/6)",
      });
      manager.recordProgress({
        bookId: "book-2",
        progression: 0.8,
        locator: "epubcfi(/6/40)",
      });

      expect(manager.hasPendingProgress("book-1")).toBe(true);
      expect(manager.hasPendingProgress("book-2")).toBe(true);
      expect(manager.hasPendingProgress()).toBe(true);

      await manager.flush();

      expect(mockProgressRepo.upsert).toHaveBeenCalledTimes(2);
      expect(storedProgress.get("book-1")?.progression).toBe(0.3);
      expect(storedProgress.get("book-2")?.progression).toBe(0.8);
      expect(manager.hasPendingProgress()).toBe(false);
    });

    it("handles SQLite database error gracefully without throwing", async () => {
      const onError = vi.fn();
      manager = new LocalProgressManager(mockProgressRepo, mockBookRepo, {
        debounceMs: 1000,
        onError,
      });

      (mockProgressRepo.upsert as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Disk I/O error or SQLite busy"),
      );

      manager.recordProgress({
        bookId: "book-1",
        progression: 0.5,
        locator: "epubcfi(/6/10)",
      });

      // flush should not throw unhandled rejection
      await expect(manager.flush()).resolves.toBeUndefined();
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it("clears pending progress on clearPending", () => {
      manager.recordProgress({
        bookId: "book-1",
        progression: 0.5,
        locator: "epubcfi(/6/10)",
      });
      expect(manager.hasPendingProgress("book-1")).toBe(true);

      manager.clearPending("book-1");
      expect(manager.hasPendingProgress("book-1")).toBe(false);
    });
  });
});
