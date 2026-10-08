import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CatalogsController, type CatalogsUiElements } from "../../src/features/catalogs/catalogs-controller.ts";
import { LibraryController, type LibraryUiElements } from "../../src/features/library/library-controller.ts";
import { ReaderViewController, type ReaderViewElements } from "../../src/features/reader/reader-view.ts";
import type { Book, BookRepository, ProgressRepository, SourceRepository, CatalogSource } from "../../src/domain/database.ts";
import type { DownloadProgress, DownloadRequest, DownloadResult, DownloadService } from "../../src/domain/downloads.ts";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

describe("Milestone M9 Integration: OPDS + Downloads + Library + Reader", () => {
  let catalogElements: CatalogsUiElements;
  let libraryElements: LibraryUiElements;
  let readerElements: ReaderViewElements;

  let storedBooks: Book[];
  let storedSources: CatalogSource[];
  let storedProgress: Map<string, { progression: number; locator: string; title?: string }>;

  let mockBookRepo: BookRepository;
  let mockProgressRepo: ProgressRepository;
  let mockSourceRepo: SourceRepository;
  let mockDownloadService: DownloadService;
  let progressListeners: Set<(p: DownloadProgress) => void>;

  let catalogsController: CatalogsController;
  let libraryController: LibraryController;
  let readerController: ReaderViewController;

  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.stubGlobal("alert", vi.fn());
    storedBooks = [];
    storedSources = [{
      id: "catalog-se",
      name: "Standard Ebooks",
      url: "https://standardebooks.org/opds",
      description: "Free public domain books",
      username: null,
      authType: "none",
      authData: null,
      createdAt: "2026-10-08T00:00:00Z",
      updatedAt: "2026-10-08T00:00:00Z",
    }];
    storedProgress = new Map();
    progressListeners = new Set();

    mockBookRepo = {
      findById: vi.fn(async (id: string) => storedBooks.find((b) => b.id === id) ?? null),
      findAll: vi.fn(async () => [...storedBooks]),
      insert: vi.fn(async (book: Book) => {
        storedBooks.push(book);
      }),
      update: vi.fn(async (book: Book) => {
        const idx = storedBooks.findIndex((b) => b.id === book.id);
        if (idx >= 0) storedBooks[idx] = book;
      }),
      updateLastOpened: vi.fn(async (id: string, timestamp: string) => {
        const b = storedBooks.find((book) => book.id === id);
        if (b) b.lastOpenedAt = timestamp;
      }),
      delete: vi.fn(async (id: string) => {
        storedBooks = storedBooks.filter((b) => b.id !== id);
      }),
    };

    mockProgressRepo = {
      findByBookId: vi.fn(async (bookId: string) => {
        const p = storedProgress.get(bookId);
        if (!p) return null;
        return {
          bookId,
          progression: p.progression,
          locator: p.locator,
          chapterTitle: p.title ?? null,
          href: null,
          modifiedAt: "2026-10-08T00:00:00Z",
          syncedAt: null,
        };
      }),
      upsert: vi.fn(async (record) => {
        storedProgress.set(record.bookId, {
          progression: record.progression,
          locator: record.locator,
          title: record.chapterTitle ?? undefined,
        });
      }),
      deleteByBookId: vi.fn(async (bookId: string) => {
        storedProgress.delete(bookId);
      }),
    };

    mockSourceRepo = {
      findById: vi.fn(async (id: string) => storedSources.find((s) => s.id === id) ?? null),
      findByUrl: vi.fn(async (url: string) => storedSources.find((s) => s.url === url) ?? null),
      findAll: vi.fn(async () => [...storedSources]),
      insert: vi.fn(async (source: CatalogSource) => { storedSources.push(source); }),
      update: vi.fn(async () => undefined),
      delete: vi.fn(async (id: string) => {
        storedSources = storedSources.filter((s) => s.id !== id);
      }),
    };

    mockDownloadService = {
      downloadBook: vi.fn(async (req: DownloadRequest): Promise<DownloadResult> => {
        return {
          bookId: req.bookId,
          localPath: `/app-data/books/${req.bookId}/book.epub`,
          fileSize: req.expectedSize ?? 125000,
        };
      }),
      cancelDownload: vi.fn(async () => true),
      getDownloadStatus: vi.fn(async () => null),
      onProgress: vi.fn((cb: (p: DownloadProgress) => void) => {
        progressListeners.add(cb);
        return () => progressListeners.delete(cb);
      }),
      destroy: vi.fn(),
    };

    // Mock Tauri IPC invoke
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((cmd: string, args: unknown) => {
      if (cmd === "read_book_file") {
        // Return dummy valid EPUB ArrayBuffer
        return Promise.resolve(new ArrayBuffer(1024));
      }
      if (cmd === "delete_book_file") {
        return Promise.resolve(true);
      }
      return Promise.resolve(args);
    });

    // Mock fetch for OPDS
    mockFetch = vi.fn().mockImplementation(async () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <id>catalog-standardebooks</id>
        <title>Standard Ebooks Feed</title>
        <updated>2026-10-08T00:00:00Z</updated>
        <entry>
          <id>se-frankenstein</id>
          <title>Frankenstein</title>
          <author><name>Mary Shelley</name></author>
          <category term="horror" label="Gothic Horror" />
          <link rel="http://opds-spec.org/image" href="https://standardebooks.org/covers/frankenstein.jpg" />
          <link rel="http://opds-spec.org/acquisition/open-access" href="https://standardebooks.org/ebooks/frankenstein.epub" type="application/epub+zip" length="125000" />
        </entry>
        <entry>
          <id>se-pride-and-prejudice</id>
          <title>Pride and Prejudice</title>
          <author><name>Jane Austen</name></author>
          <category term="romance" label="Romance" />
          <link rel="http://opds-spec.org/image" href="https://standardebooks.org/covers/pride.jpg" />
          <link rel="http://opds-spec.org/acquisition/open-access" href="https://standardebooks.org/ebooks/pride.epub" type="application/epub+zip" length="245000" />
        </entry>
      </feed>`;
      return new Response(xml, { status: 200, headers: { "Content-Type": "application/atom+xml" } });
    });
    vi.stubGlobal("fetch", mockFetch);

    // DOM Setup
    // Catalogs DOM
    const catalogContainer = document.createElement("section");
    const catalogList = document.createElement("div");
    const feedView = document.createElement("div");
    feedView.classList.add("hidden");
    const feedBreadcrumb = document.createElement("div");
    const feedTitle = document.createElement("h3");
    const searchInput = document.createElement("input");
    const searchBtn = document.createElement("button");
    const feedList = document.createElement("div");
    const feedLoading = document.createElement("div");
    const feedEmpty = document.createElement("div");
    const feedError = document.createElement("div");
    const paginationPrev = document.createElement("button");
    const paginationNext = document.createElement("button");
    const paginationInfo = document.createElement("span");
    const addCatalogBtn = document.createElement("button");
    const addCatalogModal = document.createElement("div");
    const addCatalogForm = document.createElement("form");

    catalogContainer.append(catalogList, feedView);
    feedView.append(feedBreadcrumb, feedTitle, searchInput, searchBtn, feedLoading, feedError, feedList, feedEmpty, paginationPrev, paginationNext, paginationInfo);

    catalogElements = {
      container: catalogContainer,
      catalogList,
      feedView,
      feedTitle,
      feedBreadcrumb,
      feedList,
      feedEmpty,
      feedLoading,
      feedError,
      addCatalogBtn,
      addCatalogModal,
      addCatalogForm,
      searchInput: searchInput as HTMLInputElement,
      searchBtn: searchBtn as HTMLButtonElement,
      paginationPrev: paginationPrev as HTMLButtonElement,
      paginationNext: paginationNext as HTMLButtonElement,
      paginationInfo,
    };

    // Library DOM
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

    // Reader DOM
    const readerOverlay = document.createElement("div");
    readerOverlay.classList.add("hidden");
    const readerMount = document.createElement("div");
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

    readerOverlay.append(readerMount, backBtn, title, chapter, progressBadge, cfiDisplay, tocBtn, tocDrawer, settingsBtn, settingsDrawer, prevBtn, nextBtn, slider);

    readerElements = {
      overlay: readerOverlay,
      mount: readerMount,
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

    readerController = new ReaderViewController(readerElements);
    vi.spyOn(readerController, "openBook").mockResolvedValue(undefined);

    libraryController = new LibraryController(
      libraryElements,
      mockBookRepo,
      mockProgressRepo,
      readerController,
      readerElements,
    );

    catalogsController = new CatalogsController(
      catalogElements,
      mockDownloadService,
      mockBookRepo,
      mockSourceRepo,
      {
        onBookAcquired: () => {
          void libraryController.loadBooks();
        },
        onReadNow: (bookId) => {
          void libraryController.openBook(bookId);
        },
      },
    );

    await catalogsController.loadCatalogs();
  });

  afterEach(() => {
    catalogsController.destroy();
    libraryController.destroy();
    readerController.close();
  });

  it("completes seamless acquisition pipeline: browse -> download -> SQLite commit -> library update -> Read Now", async () => {
    // 1. Browse catalog feed
    await catalogsController.loadFeed("https://standardebooks.org/opds");

    expect(catalogElements.feedView.classList.contains("hidden")).toBe(false);
    expect(catalogElements.feedTitle.textContent).toBe("Standard Ebooks Feed");

    // 2. Entries rendered with Download buttons
    const cards = catalogElements.feedList.querySelectorAll<HTMLElement>(".entry-card");
    expect(cards.length).toBe(2);

    const frankensteinCard = cards[0];
    expect(frankensteinCard.textContent).toContain("Frankenstein");
    const downloadBtn = frankensteinCard.querySelector<HTMLButtonElement>(".btn-acquire");
    expect(downloadBtn).not.toBeNull();
    expect(downloadBtn?.textContent?.trim()).toBe("Download");

    // 3. Trigger download
    downloadBtn?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Verify downloadService was invoked with expected parameters
    expect(mockDownloadService.downloadBook).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Frankenstein",
        url: "https://standardebooks.org/ebooks/frankenstein.epub",
        expectedSize: 125000,
        authors: "Mary Shelley",
      }),
    );

    // Wait for async download execution and database registration
    await new Promise((resolve) => setTimeout(resolve, 20));

    // 4. Verify book is registered in SQLite BookRepository
    const inserted = await mockBookRepo.findById("opds-se-frankenstein");
    expect(inserted).not.toBeNull();
    expect(inserted?.title).toBe("Frankenstein");
    expect(inserted?.authors).toBe("Mary Shelley");
    expect(inserted?.localPath).toBe("/app-data/books/opds-se-frankenstein/book.epub");
    expect(inserted?.fileSize).toBe(125000);

    // 5. Verify card updated to 'Read Now'
    const readNowBtn = frankensteinCard.querySelector<HTMLButtonElement>(".btn-read-now");
    expect(readNowBtn).not.toBeNull();
    expect(readNowBtn?.textContent).toContain("Read Now");

    // 6. Verify library bookshelf updated with the new book
    const libraryCards = libraryElements.list.querySelectorAll<HTMLElement>(".book-card");
    expect(libraryCards.length).toBe(1);
    expect(libraryCards[0].textContent).toContain("Frankenstein");

    // 7. Click 'Read Now' on catalog card to launch Reader
    readNowBtn?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockInvoke).toHaveBeenCalledWith("read_book_file", {
      path: "/app-data/books/opds-se-frankenstein/book.epub",
    });
    expect(readerController.openBook).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.objectContaining({
        bookId: "opds-se-frankenstein",
      }),
    );
  });

  it("detects pre-downloaded books on catalog feed load and displays 'Read Now'", async () => {
    // Pre-populate database with Pride and Prejudice
    await mockBookRepo.insert({
      id: "opds-se-pride-and-prejudice",
      sourceId: "catalog-se",
      remoteId: "se-pride-and-prejudice",
      title: "Pride and Prejudice",
      subtitle: null,
      authors: "Jane Austen",
      coverUrl: null,
      acquisitionUrl: "https://standardebooks.org/ebooks/pride.epub",
      mimeType: "application/epub+zip",
      localPath: "/app-data/books/opds-se-pride-and-prejudice/book.epub",
      fileSize: 245000,
      downloadedAt: "2026-10-08T00:00:00Z",
    });

    // Load feed
    await catalogsController.loadFeed("https://standardebooks.org/opds");

    const cards = catalogElements.feedList.querySelectorAll<HTMLElement>(".entry-card");
    const prideCard = cards[1];
    expect(prideCard.textContent).toContain("Pride and Prejudice");

    // Should already display Read Now
    const readNowBtn = prideCard.querySelector<HTMLButtonElement>(".btn-read-now");
    expect(readNowBtn).not.toBeNull();
    expect(readNowBtn?.textContent).toContain("Read Now");

    // Clicking Read Now opens reader without re-downloading
    readNowBtn?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockDownloadService.downloadBook).not.toHaveBeenCalled();
    expect(readerController.openBook).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.objectContaining({ bookId: "opds-se-pride-and-prejudice" }),
    );
  });

  it("renders real-time download progress on entry card during acquisition", async () => {
    await catalogsController.loadFeed("https://standardebooks.org/opds");

    const frankensteinCard = catalogElements.feedList.querySelector<HTMLElement>(".entry-card")!;
    const downloadBtn = frankensteinCard.querySelector<HTMLButtonElement>(".btn-acquire")!;

    // Make download promise hang until triggered
    let resolveDownload: (res: DownloadResult) => void;
    (mockDownloadService.downloadBook as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise((resolve) => { resolveDownload = resolve; }),
    );

    downloadBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Simulate progress event from native backend (50% progress)
    for (const listener of progressListeners) {
      listener({
        bookId: "opds-se-frankenstein",
        status: "downloading",
        bytesDownloaded: 62500,
        totalBytes: 125000,
        progress: 0.5,
      });
    }

    // Card should now display Downloading status and progress bar
    const downloadingBtn = frankensteinCard.querySelector<HTMLButtonElement>(".btn-downloading");
    expect(downloadingBtn).not.toBeNull();
    expect(downloadingBtn?.textContent).toContain("Downloading (50%)");

    const progressBar = frankensteinCard.querySelector<HTMLElement>(".entry-progress-fill");
    expect(progressBar).not.toBeNull();
    expect(progressBar?.style.width).toBe("50%");

    // Complete download
    resolveDownload!({
      bookId: "opds-se-frankenstein",
      localPath: "/app-data/books/opds-se-frankenstein/book.epub",
      fileSize: 125000,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Progress bar removed and replaced with Read Now
    expect(frankensteinCard.querySelector(".btn-read-now")).not.toBeNull();
    expect(frankensteinCard.querySelector(".entry-progress-bar")).toBeNull();
  });

  it("supports 'Read Now' from Book Details modal for downloaded books", async () => {
    // Add book to database
    await mockBookRepo.insert({
      id: "opds-se-frankenstein",
      sourceId: "catalog-se",
      remoteId: "se-frankenstein",
      title: "Frankenstein",
      subtitle: null,
      authors: "Mary Shelley",
      coverUrl: null,
      acquisitionUrl: "https://standardebooks.org/ebooks/frankenstein.epub",
      mimeType: "application/epub+zip",
      localPath: "/app-data/books/opds-se-frankenstein/book.epub",
      fileSize: 125000,
      downloadedAt: "2026-10-08T00:00:00Z",
    });

    await catalogsController.loadFeed("https://standardebooks.org/opds");

    const frankensteinCard = catalogElements.feedList.querySelector<HTMLElement>(".entry-card")!;
    const detailsBtn = frankensteinCard.querySelector<HTMLButtonElement>(".btn-details")!;

    detailsBtn.click();

    const modal = document.querySelector<HTMLElement>(".details-modal");
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain("Frankenstein");

    // Modal has Read Now button
    const modalReadNowBtn = modal?.querySelector<HTMLButtonElement>(".modal-read-now");
    expect(modalReadNowBtn).not.toBeNull();
    expect(modalReadNowBtn?.textContent).toContain("Read Now");

    modalReadNowBtn?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(readerController.openBook).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.objectContaining({ bookId: "opds-se-frankenstein" }),
    );
  });

  it("verifies offline book reading with zero network overhead", async () => {
    // Add book to library
    const bookId = "opds-se-frankenstein";
    await mockBookRepo.insert({
      id: bookId,
      sourceId: "catalog-se",
      remoteId: "se-frankenstein",
      title: "Frankenstein",
      subtitle: null,
      authors: "Mary Shelley",
      coverUrl: null,
      acquisitionUrl: "https://standardebooks.org/ebooks/frankenstein.epub",
      mimeType: "application/epub+zip",
      localPath: `/app-data/books/${bookId}/book.epub`,
      fileSize: 125000,
      downloadedAt: "2026-10-08T00:00:00Z",
    });

    // Mock progress position
    await mockProgressRepo.upsert({
      bookId,
      progression: 0.35,
      locator: "epubcfi(/6/14[chapter-2]!/4/2/1:0)",
      chapterTitle: "Chapter 2",
      modifiedAt: "2026-10-08T00:00:00Z",
    });

    // Clear fetch calls
    mockFetch.mockClear();

    // Open book directly via LibraryController (offline reading)
    await libraryController.openBook(bookId);

    // ZERO network overhead: fetch must not be called
    expect(mockFetch).not.toHaveBeenCalled();

    // Local file read via Tauri command
    expect(mockInvoke).toHaveBeenCalledWith("read_book_file", {
      path: `/app-data/books/${bookId}/book.epub`,
    });

    // Reader opened with restored position
    expect(readerController.openBook).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.objectContaining({
        bookId,
        initialPosition: "epubcfi(/6/14[chapter-2]!/4/2/1:0)",
      }),
    );
  });

  it("resets entry card state gracefully if download fails or is cancelled", async () => {
    await catalogsController.loadFeed("https://standardebooks.org/opds");

    const frankensteinCard = catalogElements.feedList.querySelector<HTMLElement>(".entry-card")!;
    const downloadBtn = frankensteinCard.querySelector<HTMLButtonElement>(".btn-acquire")!;

    // Reject download
    (mockDownloadService.downloadBook as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network connection lost"),
    );

    downloadBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Verify card resets to download button
    const resetAcquireBtn = frankensteinCard.querySelector<HTMLButtonElement>(".btn-acquire");
    expect(resetAcquireBtn).not.toBeNull();
    expect(resetAcquireBtn?.textContent?.trim()).toBe("Download");

    // Book was NOT inserted into SQLite
    const inserted = await mockBookRepo.findById("opds-se-frankenstein");
    expect(inserted).toBeNull();
  });
});
