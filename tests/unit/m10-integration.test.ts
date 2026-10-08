import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ReaderViewController, type ReaderViewElements } from "../../src/features/reader/reader-view.ts";
import { FoliateReaderAdapter } from "../../src/services/reader/foliate-adapter.ts";
import { LibraryController, type LibraryUiElements } from "../../src/features/library/library-controller.ts";
import { LocalProgressManager } from "../../src/services/progress/local-progress-manager.ts";
import type { Book, BookRepository, ProgressRepository, ReadingProgress } from "../../src/domain/database.ts";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

describe("Milestone M10 Integration: Local Reading Progress", () => {
  let readerElements: ReaderViewElements;
  let libraryElements: LibraryUiElements;

  let storedBooks: Map<string, Book>;
  let storedProgress: Map<string, ReadingProgress>;

  let mockBookRepo: BookRepository;
  let mockProgressRepo: ProgressRepository;
  let progressManager: LocalProgressManager;
  let readerController: ReaderViewController;
  let libraryController: LibraryController;

  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    storedBooks = new Map();
    storedProgress = new Map();

    mockBookRepo = {
      findById: vi.fn(async (id: string) => storedBooks.get(id) ?? null),
      findByLocalPath: vi.fn(async () => null),
      findAll: vi.fn(async () => Array.from(storedBooks.values())),
      insert: vi.fn(async (b: Book) => { storedBooks.set(b.id, b); }),
      update: vi.fn(async (b: Book) => { storedBooks.set(b.id, b); }),
      updateLastOpened: vi.fn(async (id: string, timestamp: string) => {
        const b = storedBooks.get(id);
        if (b) b.lastOpenedAt = timestamp;
      }),
      delete: vi.fn(async (id: string) => { storedBooks.delete(id); }),
      count: vi.fn(async () => storedBooks.size),
    };

    mockProgressRepo = {
      findByBookId: vi.fn(async (bookId: string) => storedProgress.get(bookId) ?? null),
      upsert: vi.fn(async (record: ReadingProgress) => {
        storedProgress.set(record.bookId, record);
      }),
      delete: vi.fn(async (bookId: string) => {
        storedProgress.delete(bookId);
      }),
    };

    progressManager = new LocalProgressManager(mockProgressRepo, mockBookRepo, { debounceMs: 1000 });

    mockInvoke.mockReset();
    mockInvoke.mockImplementation((cmd: string, args: unknown) => {
      if (cmd === "read_book_file") {
        return Promise.resolve(new ArrayBuffer(1024));
      }
      return Promise.resolve(args);
    });

    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    vi.spyOn(FoliateReaderAdapter.prototype, "open").mockResolvedValue(undefined);

    // DOM Setup
    const overlay = document.createElement("div");
    overlay.classList.add("hidden");
    const mount = document.createElement("div");
    const backBtn = document.createElement("button");
    const title = document.createElement("div");
    const chapter = document.createElement("div");
    const progressBadge = document.createElement("div");
    const cfiDisplay = document.createElement("div");
    const tocBtn = document.createElement("button");
    const tocDrawer = document.createElement("div");
    const tocList = document.createElement("div");
    const tocBackdrop = document.createElement("div");
    const tocCloseBtn = document.createElement("button");
    const settingsBtn = document.createElement("button");
    const settingsDrawer = document.createElement("div");
    const settingsCloseBtn = document.createElement("button");
    const prevBtn = document.createElement("button");
    const nextBtn = document.createElement("button");
    const slider = document.createElement("input");
    const fontSizeLabel = document.createElement("span");
    const smallerFontBtn = document.createElement("button");
    const largerFontBtn = document.createElement("button");

    overlay.append(mount, backBtn, title, chapter, progressBadge, cfiDisplay, tocBtn, tocDrawer, settingsBtn, settingsDrawer, prevBtn, nextBtn, slider);

    readerElements = {
      overlay,
      mount,
      backBtn: backBtn as HTMLButtonElement,
      title,
      chapter,
      progressBadge,
      cfiDisplay,
      tocBtn: tocBtn as HTMLButtonElement,
      tocDrawer,
      tocList,
      tocBackdrop,
      tocCloseBtn: tocCloseBtn as HTMLButtonElement,
      settingsBtn: settingsBtn as HTMLButtonElement,
      settingsDrawer,
      settingsCloseBtn: settingsCloseBtn as HTMLButtonElement,
      prevBtn: prevBtn as HTMLButtonElement,
      nextBtn: nextBtn as HTMLButtonElement,
      slider: slider as HTMLInputElement,
      themeButtons: document.querySelectorAll(".theme-btn"),
      fontSizeLabel,
      smallerFontBtn: smallerFontBtn as HTMLButtonElement,
      largerFontBtn: largerFontBtn as HTMLButtonElement,
    };

    readerController = new ReaderViewController(
      readerElements,
      { theme: "light", fontSize: 18 },
      {
        onPositionChange: (pos, bookId) => {
          if (bookId) {
            progressManager.recordProgress({
              bookId,
              progression: pos.progression,
              locator: pos.locator,
              href: pos.href,
              chapterTitle: pos.title,
              modifiedAt: pos.modifiedAt,
            });
          }
        },
        onBeforeClose: async () => {
          await progressManager.flush();
        },
        onClose: () => {
          void libraryController.loadBooks();
        },
      },
    );

    const libraryContainer = document.createElement("section");
    const libraryList = document.createElement("div");
    const libraryEmpty = document.createElement("div");
    const sortSelect = document.createElement("select");
    const refreshBtn = document.createElement("button");
    libraryContainer.append(libraryList, libraryEmpty, sortSelect, refreshBtn);

    libraryElements = {
      container: libraryContainer,
      list: libraryList,
      emptyState: libraryEmpty,
      sortSelect: sortSelect as HTMLSelectElement,
      refreshBtn: refreshBtn as HTMLButtonElement,
    };

    libraryController = new LibraryController(
      libraryElements,
      mockBookRepo,
      mockProgressRepo,
      readerController,
      readerElements,
    );
  });

  afterEach(() => {
    progressManager.destroy();
    readerController.close();
    libraryController.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("tracks reading progress on page turn, debounces SQLite writes, and flushes on reader close", async () => {
    // 1. Seed library with a downloaded book
    const bookId = "book-frankenstein";
    await mockBookRepo.insert({
      id: bookId,
      title: "Frankenstein",
      authors: "Mary Shelley",
      acquisitionUrl: "https://example.com/frankenstein.epub",
      mimeType: "application/epub+zip",
      localPath: `/app-data/books/${bookId}/book.epub`,
      fileSize: 125000,
      downloadedAt: "2026-10-08T00:00:00Z",
    });

    // 2. Open book via LibraryController
    await libraryController.openBook(bookId);
    expect(mockInvoke).toHaveBeenCalledWith("read_book_file", { path: `/app-data/books/${bookId}/book.epub` });
    expect(readerElements.overlay.classList.contains("hidden")).toBe(false);

    // 3. Simulate page turns (relocate events)
    const reader = readerController.getReader()!;
    expect(reader).not.toBeNull();

    // Emulate relocate event from reader engine
    const relocateEvent = (cfi: string, fraction: number, chapter: string) => {
      (reader as any).dispatchEvent("relocate", {
        progression: fraction,
        locator: cfi,
        title: chapter,
        modifiedAt: "2026-10-08T12:00:00Z",
      });
    };

    // First page turn (10%)
    relocateEvent("epubcfi(/6/4[ch1]!/4/2/4)", 0.1, "Chapter 1");
    // Rapid second page turn (15%) within 200ms
    vi.advanceTimersByTime(200);
    relocateEvent("epubcfi(/6/4[ch1]!/4/2/12)", 0.15, "Chapter 1");
    // Rapid third page turn (20%) within 200ms
    vi.advanceTimersByTime(200);
    relocateEvent("epubcfi(/6/6[ch2]!/4/2/2)", 0.2, "Chapter 2");

    // UI elements updated immediately
    expect(readerElements.progressBadge.textContent).toBe("20%");
    expect(readerElements.chapter.textContent).toBe("Chapter 2");

    // SQLite should NOT have written yet because of 1000ms debounce
    expect(mockProgressRepo.upsert).not.toHaveBeenCalled();
    expect(progressManager.hasPendingProgress(bookId)).toBe(true);

    // 4. Close reader (triggers onBeforeClose -> flush)
    await readerController.close();

    // SQLite upsert was committed immediately on close without waiting for timer
    expect(mockProgressRepo.upsert).toHaveBeenCalledTimes(1);
    expect(mockProgressRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId,
        progression: 0.2,
        locator: "epubcfi(/6/6[ch2]!/4/2/2)",
        chapterTitle: "Chapter 2",
      }),
    );
    expect(mockBookRepo.updateLastOpened).toHaveBeenCalledWith(bookId, expect.any(String));

    // 5. Library bookshelf reflects updated reading progress
    await libraryController.loadBooks();
    const bookCard = libraryElements.list.querySelector<HTMLElement>(".book-card")!;
    expect(bookCard.textContent).toContain("20% read");
    expect(bookCard.textContent).toContain("Chapter 2");
    const progressFill = bookCard.querySelector<HTMLElement>(".book-progress-fill")!;
    expect(progressFill.style.width).toBe("20%");
  });

  it("recovers gracefully and uses fractional progression fallback when initialPosition locator CFI is corrupted", async () => {
    const bookId = "book-dracula";
    await mockBookRepo.insert({
      id: bookId,
      title: "Dracula",
      authors: "Bram Stoker",
      acquisitionUrl: "https://example.com/dracula.epub",
      mimeType: "application/epub+zip",
      localPath: `/app-data/books/${bookId}/book.epub`,
      fileSize: 200000,
      downloadedAt: "2026-10-08T00:00:00Z",
    });

    // Seed progress with a corrupted/malformed CFI locator but valid progression (45%)
    await mockProgressRepo.upsert({
      bookId,
      progression: 0.45,
      locator: "corrupted_or_invalid_cfi_syntax(!#?)",
      chapterTitle: "Chapter 4",
      modifiedAt: "2026-10-08T00:00:00Z",
    });

    // Spy on reader adapter
    await libraryController.openBook(bookId);
    const reader = readerController.getReader()!;

    // Mock goTo to reject for the invalid CFI
    const goToSpy = vi.spyOn(reader, "goTo").mockRejectedValueOnce(
      new Error("Invalid CFI syntax"),
    );
    // Mock goToFraction to succeed
    const goToFractionSpy = vi.spyOn(reader, "goToFraction").mockResolvedValueOnce(undefined);

    // Call openBook again simulating opening with corrupted position
    await readerController.openBook(new ArrayBuffer(1024), {
      bookId,
      initialPosition: "corrupted_or_invalid_cfi_syntax(!#?)",
      initialProgression: 0.45,
    });

    // Verification: goTo threw error, caught, and goToFraction was invoked as fallback recovery
    expect(goToSpy).toHaveBeenCalledWith("corrupted_or_invalid_cfi_syntax(!#?)");
    expect(goToFractionSpy).toHaveBeenCalledWith(0.45);

    // Overlay is open and functional, not crashed
    expect(readerElements.overlay.classList.contains("hidden")).toBe(false);
  });

  it("flushes pending reading progress immediately on visibilitychange (app backgrounding)", async () => {
    const bookId = "book-sherlock";
    await mockBookRepo.insert({
      id: bookId,
      title: "The Adventures of Sherlock Holmes",
      authors: "Arthur Conan Doyle",
      acquisitionUrl: "https://example.com/sherlock.epub",
      mimeType: "application/epub+zip",
      localPath: `/app-data/books/${bookId}/book.epub`,
      fileSize: 150000,
      downloadedAt: "2026-10-08T00:00:00Z",
    });

    await libraryController.openBook(bookId);

    // Register visibilitychange listener as done in main.ts
    const visibilityHandler = () => {
      if (document.visibilityState === "hidden") {
        void progressManager.flush();
      }
    };
    document.addEventListener("visibilitychange", visibilityHandler);

    // Record progress while reading
    progressManager.recordProgress({
      bookId,
      progression: 0.65,
      locator: "epubcfi(/6/18[ch5]!/4/2/8)",
      chapterTitle: "A Scandal in Bohemia",
    });

    expect(mockProgressRepo.upsert).not.toHaveBeenCalled();

    // Simulate mobile OS backgrounding the app
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Flush should execute immediately
    await vi.runAllTimersAsync();

    expect(mockProgressRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId,
        progression: 0.65,
        locator: "epubcfi(/6/18[ch5]!/4/2/8)",
      }),
    );
    expect(progressManager.hasPendingProgress(bookId)).toBe(false);

    document.removeEventListener("visibilitychange", visibilityHandler);
  });

  it("maintains zero network overhead during reading progress tracking", async () => {
    const bookId = "book-time-machine";
    await mockBookRepo.insert({
      id: bookId,
      title: "The Time Machine",
      authors: "H.G. Wells",
      acquisitionUrl: "https://example.com/timemachine.epub",
      mimeType: "application/epub+zip",
      localPath: `/app-data/books/${bookId}/book.epub`,
      fileSize: 85000,
      downloadedAt: "2026-10-08T00:00:00Z",
    });

    await libraryController.openBook(bookId);

    // Turn pages
    progressManager.recordProgress({
      bookId,
      progression: 0.35,
      locator: "epubcfi(/6/8!/4/2/6)",
      chapterTitle: "Chapter 3",
    });

    await progressManager.flush();

    // Verify ZERO network calls were made
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
