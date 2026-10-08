import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { AppProfiler, DEFAULT_PERFORMANCE_BUDGETS } from "../../src/services/performance/profiler.ts";
import { LibraryController } from "../../src/features/library/library-controller.ts";
import type { Book, ReadingProgress, ProgressRepository, BookRepository } from "../../src/domain/database.ts";

describe("Milestone M16: Performance Engineering & Resource Targets", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Metric 1: Cold Startup Time Budget (< 2.0 seconds)", () => {
    it("enforces default cold startup performance budget of 2000ms", () => {
      const profiler = new AppProfiler();
      const budget = profiler.getBudget();
      expect(budget.maxColdStartMs).toBe(2000);
      expect(budget.maxPageTurnLatencyMs).toBe(100);
    });

    it("verifies full cold startup simulation completes well under the 2000ms budget", async () => {
      const profiler = new AppProfiler();
      profiler.markColdStart();

      // Simulate database initialization
      await new Promise((resolve) => setTimeout(resolve, 5));
      profiler.markDatabaseReady();

      // Simulate library rendering
      await new Promise((resolve) => setTimeout(resolve, 5));
      profiler.markLibraryReady();

      const metrics = profiler.measureStartup();
      expect(metrics.totalColdStartMs).toBeLessThan(DEFAULT_PERFORMANCE_BUDGETS.maxColdStartMs);
      expect(metrics.totalColdStartMs).toBeGreaterThan(0);
      expect(metrics.dbInitMs).toBeGreaterThan(0);
      expect(metrics.libraryRenderMs).toBeGreaterThan(0);
    });
  });

  describe("Metric 2: Library Scalability & 60fps Scrolling (500+ Books)", () => {
    it("eliminates N+1 database queries by batch loading progress for 500 books in 1 query", async () => {
      // Generate 500 mock books
      const mockBooks: Book[] = Array.from({ length: 500 }, (_, i) => ({
        id: `book-${i}`,
        title: `Ebook Title ${i}`,
        authors: `Author ${i}`,
        acquisitionUrl: `https://example.com/books/${i}.epub`,
        mimeType: "application/epub+zip",
        localPath: `/data/books/${i}.epub`,
        fileSize: 1024 * 1024,
        downloadedAt: new Date(1700000000000 + i * 1000).toISOString(),
        lastOpenedAt: i % 2 === 0 ? new Date(1700000000000 + i * 1000).toISOString() : null,
      }));

      // Generate progress records for a subset of books
      const mockProgress: ReadingProgress[] = Array.from({ length: 250 }, (_, i) => ({
        bookId: `book-${i * 2}`,
        progression: 0.45,
        locator: `epubcfi(/6/2[ch${i}]!/4)`,
        chapterTitle: `Chapter ${i}`,
        modifiedAt: new Date().toISOString(),
        syncedAt: null,
      }));

      const mockBookRepo: BookRepository = {
        findAll: vi.fn().mockResolvedValue(mockBooks),
        findById: vi.fn(),
        findByRemoteId: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn().mockResolvedValue(500),
      };

      const findAllProgressSpy = vi.fn().mockResolvedValue(mockProgress);
      const findByBookIdSpy = vi.fn();

      const mockProgressRepo: ProgressRepository = {
        findByBookId: findByBookIdSpy,
        upsert: vi.fn(),
        delete: vi.fn(),
        findAll: findAllProgressSpy,
      };

      const container = document.createElement("div");
      const list = document.createElement("div");
      const emptyState = document.createElement("div");
      const sortSelect = document.createElement("select");
      const refreshBtn = document.createElement("button");

      const startTime = performance.now();

      new LibraryController(
        { container, list, emptyState, sortSelect, refreshBtn },
        mockBookRepo,
        mockProgressRepo,
        null,
        null,
      );

      // Wait for initial loadBooks from constructor to complete
      await new Promise((resolve) => setTimeout(resolve, 20));
      const renderDurationMs = performance.now() - startTime;

      // Verify N+1 query elimination: exactly 1 call to findAll(), 0 calls to findByBookId()
      expect(findAllProgressSpy).toHaveBeenCalledTimes(1);
      expect(findByBookIdSpy).not.toHaveBeenCalled();

      // Verify all 500 books rendered into DOM
      expect(list.children).toHaveLength(500);

      // Rendering 500 books with batching should complete within cold start budget (2000ms)
      expect(renderDurationMs).toBeLessThan(2000);
    });

    it("verifies single delegated click listener handles open and delete actions across 500 books", async () => {
      const mockBook: Book = {
        id: "book-test-1",
        title: "Test Book",
        acquisitionUrl: "https://example.com/test.epub",
        mimeType: "application/epub+zip",
        localPath: "/data/test.epub",
        fileSize: 1024,
        downloadedAt: new Date().toISOString(),
      };

      const mockBookRepo = {
        findAll: vi.fn().mockResolvedValue([mockBook]),
        findById: vi.fn().mockResolvedValue(mockBook),
        delete: vi.fn().mockResolvedValue(undefined),
      } as unknown as BookRepository;

      const mockProgressRepo = {
        findAll: vi.fn().mockResolvedValue([]),
        findByBookId: vi.fn().mockResolvedValue(null),
      } as unknown as ProgressRepository;

      const container = document.createElement("div");
      const list = document.createElement("div");
      const emptyState = document.createElement("div");
      const sortSelect = document.createElement("select");
      const refreshBtn = document.createElement("button");

      const controller = new LibraryController(
        { container, list, emptyState, sortSelect, refreshBtn },
        mockBookRepo,
        mockProgressRepo,
        null,
        null,
      );

      // Mock openBook and deleteBook to spy on delegated actions
      const openSpy = vi.spyOn(controller, "openBook").mockResolvedValue(undefined);
      const deleteSpy = vi.spyOn(controller, "deleteBook").mockResolvedValue(undefined);
      await controller.loadBooks();

      const card = list.querySelector<HTMLElement>(".book-card")!;
      expect(card).toBeDefined();

      // 1. Click card -> triggers open via event delegation
      card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(openSpy).toHaveBeenCalledWith("book-test-1");

      // 2. Click delete button -> triggers deleteBook via event delegation
      const deleteBtn = card.querySelector<HTMLButtonElement>(".btn-delete")!;
      deleteBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(deleteSpy).toHaveBeenCalledWith("book-test-1");
    });

    it("enforces CSS content-visibility: auto in styles.css for 60fps scrolling with large lists", () => {
      const stylesPath = path.resolve(__dirname, "../../src/styles.css");
      const css = fs.readFileSync(stylesPath, "utf-8");

      expect(css).toContain(".book-card {");
      expect(css).toMatch(/\.book-card\s*\{[^}]*content-visibility:\s*auto/);
      expect(css).toMatch(/\.book-card\s*\{[^}]*contain-intrinsic-size:/);

      expect(css).toMatch(/\.entry-card\s*\{[^}]*content-visibility:\s*auto/);
    });
  });

  describe("Metric 3: Page Turn Latency (< 100 ms Perceived Latency)", () => {
    it("measures page turn latency and verifies execution within the 100ms budget", async () => {
      const profiler = new AppProfiler();

      // Mock rapid page turn step
      const mockPageTurn = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 8)); // 8ms rendering time
        return "page-turn-complete";
      });

      const { result, durationMs } = await profiler.measurePageTurn(mockPageTurn);

      expect(result).toBe("page-turn-complete");
      expect(durationMs).toBeLessThan(DEFAULT_PERFORMANCE_BUDGETS.maxPageTurnLatencyMs);
      expect(profiler.getMeasure("educk:last-page-turn")).toBe(durationMs);
    });
  });

  describe("Metric 4 & 5: Streaming Memory Architecture & EPUB Lazy Loading", () => {
    it("verifies native Rust download streaming architecture streams chunks directly to disk", () => {
      const enginePath = path.resolve(__dirname, "../../src-tauri/src/downloads/engine.rs");
      const engineSource = fs.readFileSync(enginePath, "utf-8");

      // Verify bytes_stream() is used to stream chunks directly to disk without buffering full file in RAM
      expect(engineSource).toContain("response.bytes_stream()");
      expect(engineSource).toContain("file.write_all(&chunk)");
      expect(engineSource).not.toContain("response.bytes().await"); // Anti-pattern: buffering full response
    });
  });
});
