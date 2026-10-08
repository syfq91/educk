import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CatalogsController, type CatalogsUiElements } from "../../src/features/catalogs/catalogs-controller.ts";
import { LocalProgressManager } from "../../src/services/progress/local-progress-manager.ts";
import { ProgressionSyncManager } from "../../src/services/progression/progression-sync-manager.ts";
import type {
  Book,
  BookRepository,
  CatalogSource,
  ProgressRepository,
  ReadingProgress,
  SettingsRepository,
  SourceRepository,
  SyncState,
  SyncStateRepository,
} from "../../src/domain/database.ts";
import type { DownloadService } from "../../src/domain/downloads.ts";
import type { IProgressionClient, RemoteProgressionPayload } from "../../src/domain/progression.ts";

describe("Milestone M11 Integration: OPDS Progression 1.0 Synchronization", () => {
  let booksStore: Map<string, Book>;
  let sourcesStore: Map<string, CatalogSource>;
  let progressStore: Map<string, ReadingProgress>;
  let syncStateStore: Map<string, SyncState>;
  let settingsStore: Map<string, string>;

  let mockBookRepo: BookRepository;
  let mockSourceRepo: SourceRepository;
  let mockProgressRepo: ProgressRepository;
  let mockSyncStateRepo: SyncStateRepository;
  let mockSettingsRepo: SettingsRepository;
  let mockDownloadService: DownloadService;
  let mockProgressionClient: IProgressionClient;

  let progressManager: LocalProgressManager;
  let syncManager: ProgressionSyncManager;

  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    booksStore = new Map();
    sourcesStore = new Map();
    progressStore = new Map();
    syncStateStore = new Map();
    settingsStore = new Map();

    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    mockBookRepo = {
      findById: vi.fn(async (id: string) => booksStore.get(id) ?? null),
      findByLocalPath: vi.fn(async () => null),
      findAll: vi.fn(async () => Array.from(booksStore.values())),
      insert: vi.fn(async (b: Book) => {
        booksStore.set(b.id, b);
      }),
      update: vi.fn(async (b: Book) => {
        booksStore.set(b.id, b);
      }),
      updateLastOpened: vi.fn(async () => {}),
      delete: vi.fn(async (id: string) => {
        booksStore.delete(id);
      }),
      count: vi.fn(async () => booksStore.size),
    };

    mockSourceRepo = {
      findById: vi.fn(async (id: string) => sourcesStore.get(id) ?? null),
      findByUrl: vi.fn(async () => null),
      findAll: vi.fn(async () => Array.from(sourcesStore.values())),
      insert: vi.fn(async (s: CatalogSource) => {
        sourcesStore.set(s.id, s);
      }),
      update: vi.fn(async (s: CatalogSource) => {
        sourcesStore.set(s.id, s);
      }),
      delete: vi.fn(async (id: string) => {
        sourcesStore.delete(id);
      }),
      count: vi.fn(async () => sourcesStore.size),
    };

    mockProgressRepo = {
      findByBookId: vi.fn(async (id: string) => progressStore.get(id) ?? null),
      upsert: vi.fn(async (p: ReadingProgress) => {
        progressStore.set(p.bookId, p);
      }),
      delete: vi.fn(async (id: string) => {
        progressStore.delete(id);
      }),
    };

    mockSyncStateRepo = {
      findByBookId: vi.fn(async (id: string) => syncStateStore.get(id) ?? null),
      upsert: vi.fn(async (s: SyncState) => {
        syncStateStore.set(s.bookId, s);
      }),
      findPendingSync: vi.fn(async () =>
        Array.from(syncStateStore.values()).filter((s) =>
          ["pending", "conflict", "error"].includes(s.syncStatus),
        ),
      ),
      delete: vi.fn(async (id: string) => {
        syncStateStore.delete(id);
      }),
    };

    mockSettingsRepo = {
      get: vi.fn(async (key: string) => settingsStore.get(key) ?? null),
      getJSON: vi.fn(async (key: string) => {
        const v = settingsStore.get(key);
        return v ? JSON.parse(v) : null;
      }),
      set: vi.fn(async (key: string, value: string) => {
        settingsStore.set(key, value);
      }),
      setJSON: vi.fn(async (key: string, value: unknown) => {
        settingsStore.set(key, JSON.stringify(value));
      }),
      delete: vi.fn(async (key: string) => {
        settingsStore.delete(key);
      }),
      getAll: vi.fn(async () => Object.fromEntries(settingsStore.entries())),
    };

    mockDownloadService = {
      downloadBook: vi.fn(async () => ({
        bookId: "book-1",
        localPath: "/books/book-1/book.epub",
        fileSize: 50000,
        sha256: "hash123",
      })),
      cancelDownload: vi.fn(async () => true),
      getActiveDownloads: vi.fn(async () => []),
      onProgress: vi.fn(() => () => {}),
    };

    mockProgressionClient = {
      getProgression: vi.fn(),
      putProgression: vi.fn().mockResolvedValue(true),
    };

    syncManager = new ProgressionSyncManager({
      progressRepo: mockProgressRepo,
      syncStateRepo: mockSyncStateRepo,
      settingsRepo: mockSettingsRepo,
      bookRepo: mockBookRepo,
      sourceRepo: mockSourceRepo,
      client: mockProgressionClient,
    });

    progressManager = new LocalProgressManager(mockProgressRepo, mockBookRepo, {
      debounceMs: 50,
      onProgressSaved: (update) => {
        void syncManager.syncBook(update.bookId, { isSessionActive: true });
      },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    progressManager.destroy();
    syncManager.destroy();
    vi.restoreAllMocks();
  });

  it("registers progression URL upon catalog book download when progression link is present", async () => {
    const catalogXml = `<?xml version="1.0" encoding="utf-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <id>urn:feed:1</id>
      <title>Test Catalog</title>
      <entry>
        <id>urn:book:pride-prejudice</id>
        <title>Pride and Prejudice</title>
        <link rel="http://opds-spec.org/acquisition/open-access" href="https://example.com/books/pride.epub" type="application/epub+zip" />
        <link rel="http://opds-spec.org/progression" href="https://example.com/progression/pride-prejudice" type="application/json" />
      </entry>
    </feed>`;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/atom+xml" }),
      text: async () => catalogXml,
    });

    const section = document.createElement("section");
    section.id = "view-catalogs";
    const catalogList = document.createElement("div");
    section.appendChild(catalogList);
    const feedView = document.createElement("div");
    section.appendChild(feedView);

    const uiElements: CatalogsUiElements = {
      container: section,
      catalogList,
      feedView,
      feedTitle: document.createElement("div"),
      feedBreadcrumb: document.createElement("div"),
      feedList: document.createElement("div"),
      feedEmpty: document.createElement("div"),
      feedLoading: document.createElement("div"),
      feedError: document.createElement("div"),
      addCatalogBtn: document.createElement("button"),
      addCatalogModal: document.createElement("div"),
      addCatalogForm: document.createElement("form"),
      searchInput: document.createElement("input"),
      searchBtn: document.createElement("button"),
      paginationPrev: document.createElement("button"),
      paginationNext: document.createElement("button"),
      paginationInfo: document.createElement("div"),
    };

    const controller = new CatalogsController(
      uiElements,
      mockDownloadService,
      mockBookRepo,
      mockSourceRepo,
      {
        onProgressionDiscovered: (bookId, progressionUrl) => {
          void syncManager.registerProgressionUrl(bookId, progressionUrl);
        },
      },
    );

    await controller.loadFeed("https://example.com/opds");

    // Click download button on rendered card
    const downloadBtn = uiElements.feedList.querySelector<HTMLButtonElement>(".btn-acquire");
    downloadBtn!.click();
    await new Promise((r) => setTimeout(r, 50));

    // Verify progression URL was registered
    const bookId = Array.from(booksStore.keys())[0];
    expect(bookId).toBeDefined();

    const registeredUrl = await syncManager.getProgressionUrl(bookId);
    expect(registeredUrl).toBe("https://example.com/progression/pride-prejudice");

    // Verify initial sync state in SQLite
    const syncState = await mockSyncStateRepo.findByBookId(bookId);
    expect(syncState).toBeDefined();
    expect(syncState?.syncStatus).toBe("idle");
  });

  it("strictly maintains non-blocking invariant: local progress recording never blocks on network", async () => {
    const bookId = "book-async-1";
    await syncManager.registerProgressionUrl(bookId, "https://example.com/progression/async-1");

    // Simulate very slow network request (3000ms)
    vi.mocked(mockProgressionClient.getProgression).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    );

    // Record reading progress synchronously
    const startTime = performance.now();
    progressManager.recordProgress({
      bookId,
      progression: 0.15,
      locator: "epubcfi(/6/2!/4:0)",
      modifiedAt: "2026-10-08T10:00:00Z",
    });

    const elapsed = performance.now() - startTime;
    // Local recording must execute virtually instantaneously (< 15ms)
    expect(elapsed).toBeLessThan(15);

    // Local in-memory and flush must not block on network completion
    await progressManager.flush();
    const savedLocal = await mockProgressRepo.findByBookId(bookId);
    expect(savedLocal?.progression).toBe(0.15);
  });

  it("cold open silently synchronizes newer remote progress to local repository", async () => {
    const bookId = "cold-open-book";
    await syncManager.registerProgressionUrl(bookId, "https://example.com/progression/cold");

    // Older local progress from last week
    progressStore.set(bookId, {
      bookId,
      progression: 0.2,
      locator: "epubcfi(/6/4!/4:0)",
      modifiedAt: "2026-10-01T00:00:00Z",
    });

    // Newer remote progress from another device
    const newerRemote: RemoteProgressionPayload = {
      modified: "2026-10-07T18:00:00Z",
      device: "educk-phone-xyz",
      locator: {
        title: "Chapter 12",
        locations: {
          cfi: "epubcfi(/6/24!/4:0)",
          progression: 0.65,
          totalProgression: 0.65,
        },
      },
    };
    vi.mocked(mockProgressionClient.getProgression).mockResolvedValueOnce(newerRemote);

    // Reader cold open
    const syncResult = await syncManager.syncBook(bookId, { isColdOpen: true });
    expect(syncResult.action).toBe("pulled");

    // Verify local progress has been seamlessly updated to 65%
    const updated = await mockProgressRepo.findByBookId(bookId);
    expect(updated?.progression).toBe(0.65);
    expect(updated?.locator).toBe("epubcfi(/6/24!/4:0)");
    expect(updated?.chapterTitle).toBe("Chapter 12");
  });

  it("handles concurrent conflict during active reading session and allows interactive resolution", async () => {
    const bookId = "conflict-book";
    await syncManager.registerProgressionUrl(bookId, "https://example.com/progression/conflict");

    // Local reading session has progress at 40%
    progressStore.set(bookId, {
      bookId,
      progression: 0.4,
      locator: "epubcfi(/6/8!/4:0)",
      modifiedAt: "2026-10-08T10:00:00Z",
    });

    // Remote device pushed newer progress at 70%
    const remoteNewer: RemoteProgressionPayload = {
      modified: "2026-10-08T10:30:00Z",
      device: "educk-tablet-abc",
      locator: {
        title: "Chapter 14",
        locations: {
          cfi: "epubcfi(/6/28!/4:0)",
          totalProgression: 0.7,
        },
      },
    };
    vi.mocked(mockProgressionClient.getProgression).mockResolvedValueOnce(remoteNewer);

    // Active session background sync triggers
    const syncResult = await syncManager.syncBook(bookId, { isSessionActive: true });
    expect(syncResult.action).toBe("conflict");
    expect(syncResult.conflict).toBeDefined();
    expect(syncResult.conflict?.remoteProgression).toBe(0.7);

    // User chooses "Jump to Latest" (apply_remote)
    const resolveResult = await syncManager.resolveConflict(bookId, "apply_remote");
    expect(resolveResult.action).toBe("pulled");

    const appliedProgress = await mockProgressRepo.findByBookId(bookId);
    expect(appliedProgress?.progression).toBe(0.7);
    expect(appliedProgress?.locator).toBe("epubcfi(/6/28!/4:0)");
  });

  it("queues failed sync requests for offline resilience and flushes on reconnect", async () => {
    const bookId = "offline-book";
    await syncManager.registerProgressionUrl(bookId, "https://example.com/progression/offline");

    progressStore.set(bookId, {
      bookId,
      progression: 0.35,
      locator: "epubcfi(/6/10!/4:0)",
      modifiedAt: "2026-10-08T11:00:00Z",
    });

    // Offline error
    vi.mocked(mockProgressionClient.getProgression).mockRejectedValueOnce(
      new Error("Network offline (TypeError: Failed to fetch)"),
    );

    const offlineResult = await syncManager.syncBook(bookId);
    expect(offlineResult.action).toBe("error");

    // Verify marked in SQLite sync_state queue as pending
    const state = await mockSyncStateRepo.findByBookId(bookId);
    expect(state?.syncStatus).toBe("pending");

    // Network recovers: server returns null (ready to receive push)
    vi.mocked(mockProgressionClient.getProgression).mockResolvedValueOnce(null);

    // Online event triggers syncQueue
    const queueResults = await syncManager.syncQueue();
    expect(queueResults.length).toBe(1);
    expect(queueResults[0].action).toBe("pushed");

    const syncedState = await mockSyncStateRepo.findByBookId(bookId);
    expect(syncedState?.syncStatus).toBe("synced");
    expect(mockProgressionClient.putProgression).toHaveBeenCalledTimes(1);
  });
});
