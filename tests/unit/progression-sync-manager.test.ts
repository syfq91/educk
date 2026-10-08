import { describe, it, expect, beforeEach, vi } from "vitest";
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
import type {
  IProgressionClient,
  ProgressionConflict,
  RemoteProgressionPayload,
} from "../../src/domain/progression.ts";

describe("ProgressionSyncManager", () => {
  let mockProgressRepo: ProgressRepository;
  let mockSyncStateRepo: SyncStateRepository;
  let mockSettingsRepo: SettingsRepository;
  let mockBookRepo: BookRepository;
  let mockSourceRepo: SourceRepository;
  let mockClient: IProgressionClient;

  let progressStore: Map<string, ReadingProgress>;
  let syncStateStore: Map<string, SyncState>;
  let settingsStore: Map<string, string>;
  let booksStore: Map<string, Book>;
  let sourcesStore: Map<string, CatalogSource>;

  let conflictPromptCalls: ProgressionConflict[];
  let errorCalls: Array<{ error: Error; bookId?: string }>;

  beforeEach(() => {
    progressStore = new Map();
    syncStateStore = new Map();
    settingsStore = new Map();
    booksStore = new Map();
    sourcesStore = new Map();
    conflictPromptCalls = [];
    errorCalls = [];

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

    mockClient = {
      getProgression: vi.fn(),
      putProgression: vi.fn().mockResolvedValue(true),
    };
  });

  function createManager(): ProgressionSyncManager {
    return new ProgressionSyncManager({
      progressRepo: mockProgressRepo,
      syncStateRepo: mockSyncStateRepo,
      settingsRepo: mockSettingsRepo,
      bookRepo: mockBookRepo,
      sourceRepo: mockSourceRepo,
      client: mockClient,
      callbacks: {
        onConflictPrompt: (c) => conflictPromptCalls.push(c),
        onError: (err, bId) => errorCalls.push({ error: err, bookId: bId }),
      },
    });
  }

  describe("Device ID and URL Registration", () => {
    it("generates and persists device ID on first access, then reuses it", async () => {
      const manager = createManager();
      const devId1 = await manager.getDeviceId();

      expect(devId1).toMatch(/^educk-android-/);
      expect(settingsStore.get("progression.device_id")).toBe(devId1);

      const devId2 = await manager.getDeviceId();
      expect(devId2).toBe(devId1);
      expect(mockSettingsRepo.set).toHaveBeenCalledTimes(1);
    });

    it("registers and retrieves progression endpoint URL for a book", async () => {
      const manager = createManager();
      await manager.registerProgressionUrl("book-1", "https://catalog.example/progression/book-1");

      const retrieved = await manager.getProgressionUrl("book-1");
      expect(retrieved).toBe("https://catalog.example/progression/book-1");

      const state = syncStateStore.get("book-1");
      expect(state).toBeDefined();
      expect(state?.syncStatus).toBe("idle");
    });
  });

  describe("Sync Decision Matrix", () => {
    const bookId = "moby-dick-123";
    const progressionUrl = "https://catalog.example/progression/moby-dick-123";

    beforeEach(async () => {
      booksStore.set(bookId, {
        id: bookId,
        title: "Moby Dick",
        acquisitionUrl: "https://catalog.example/epub/moby-dick.epub",
        localPath: "/books/moby-dick-123/book.epub",
        mimeType: "application/epub+zip",
        fileSize: 120000,
        downloadedAt: "2026-10-01T00:00:00Z",
        sourceId: "source-1",
      });

      sourcesStore.set("source-1", {
        id: "source-1",
        name: "Standard Catalog",
        url: "https://catalog.example/opds",
        authType: "basic",
        username: "reader_bob",
        authData: "secretpass",
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-01T00:00:00Z",
      });

      settingsStore.set(`progression.url.${bookId}`, progressionUrl);
    });

    it("skips if book has no registered progression URL", async () => {
      const manager = createManager();
      const result = await manager.syncBook("unknown-book");

      expect(result.action).toBe("skipped");
      expect(mockClient.getProgression).not.toHaveBeenCalled();
    });

    it("Case A: Pushes local progress when server has no record (null)", async () => {
      vi.mocked(mockClient.getProgression).mockResolvedValueOnce(null);

      progressStore.set(bookId, {
        bookId,
        progression: 0.25,
        locator: "epubcfi(/6/4[chap01]!/4/2:0)",
        href: "chapter1.xhtml",
        chapterTitle: "Chapter 1",
        modifiedAt: "2026-10-05T12:00:00Z",
      });

      const manager = createManager();
      const result = await manager.syncBook(bookId);

      expect(result.action).toBe("pushed");
      expect(mockClient.putProgression).toHaveBeenCalledTimes(1);

      const [putUrl, payload, auth] = vi.mocked(mockClient.putProgression).mock.calls[0];
      expect(putUrl).toBe(progressionUrl);
      expect(payload.modified).toBe("2026-10-05T12:00:00Z");
      expect(payload.locator.locations.totalProgression).toBe(0.25);
      expect(auth?.type).toBe("basic");
      expect(auth?.username).toBe("reader_bob");

      const state = syncStateStore.get(bookId);
      expect(state?.syncStatus).toBe("synced");
      expect(state?.remoteVersion).toBe("2026-10-05T12:00:00Z");

      const updatedProgress = progressStore.get(bookId);
      expect(updatedProgress?.syncedAt).toBeDefined();
    });

    it("Case B: Pulls remote progress into local database when local has no progress", async () => {
      const remotePayload: RemoteProgressionPayload = {
        modified: "2026-10-06T15:30:00Z",
        device: "educk-web-other",
        locator: {
          href: "chapter5.xhtml",
          title: "Chapter 5",
          locations: {
            cfi: "epubcfi(/6/10[chap05]!/4/2:0)",
            progression: 0.55,
            totalProgression: 0.55,
          },
        },
      };

      vi.mocked(mockClient.getProgression).mockResolvedValueOnce(remotePayload);

      const manager = createManager();
      const result = await manager.syncBook(bookId);

      expect(result.action).toBe("pulled");
      const saved = progressStore.get(bookId);
      expect(saved).toBeDefined();
      expect(saved?.progression).toBe(0.55);
      expect(saved?.locator).toBe("epubcfi(/6/10[chap05]!/4/2:0)");
      expect(saved?.chapterTitle).toBe("Chapter 5");
      expect(saved?.modifiedAt).toBe("2026-10-06T15:30:00Z");

      const state = syncStateStore.get(bookId);
      expect(state?.syncStatus).toBe("synced");
    });

    it("Case C1: Skips sync when timestamps are identical or progression matches", async () => {
      const timestamp = "2026-10-06T10:00:00Z";
      progressStore.set(bookId, {
        bookId,
        progression: 0.4,
        locator: "epubcfi(/6/8!/4/2:0)",
        modifiedAt: timestamp,
      });

      vi.mocked(mockClient.getProgression).mockResolvedValueOnce({
        modified: timestamp,
        device: "educk-another",
        locator: {
          locations: { cfi: "epubcfi(/6/8!/4/2:0)", totalProgression: 0.4 },
        },
      });

      const manager = createManager();
      const result = await manager.syncBook(bookId);

      expect(result.action).toBe("skipped");
      expect(mockClient.putProgression).not.toHaveBeenCalled();
      expect(syncStateStore.get(bookId)?.syncStatus).toBe("synced");
    });

    it("Case C2: Pushes local progress when local timestamp is newer", async () => {
      progressStore.set(bookId, {
        bookId,
        progression: 0.75,
        locator: "epubcfi(/6/14!/4/2:0)",
        modifiedAt: "2026-10-07T12:00:00Z", // Newer
      });

      vi.mocked(mockClient.getProgression).mockResolvedValueOnce({
        modified: "2026-10-06T12:00:00Z", // Older
        device: "educk-another",
        locator: {
          locations: { cfi: "epubcfi(/6/10!/4/2:0)", totalProgression: 0.5 },
        },
      });

      const manager = createManager();
      const result = await manager.syncBook(bookId);

      expect(result.action).toBe("pushed");
      expect(mockClient.putProgression).toHaveBeenCalledTimes(1);
    });

    it("Case C3: Automatically pulls newer remote progress on cold open (isColdOpen: true)", async () => {
      progressStore.set(bookId, {
        bookId,
        progression: 0.3,
        locator: "epubcfi(/6/6!/4/2:0)",
        modifiedAt: "2026-10-05T12:00:00Z", // Older
      });

      vi.mocked(mockClient.getProgression).mockResolvedValueOnce({
        modified: "2026-10-07T12:00:00Z", // Newer
        device: "educk-tablet",
        locator: {
          title: "Chapter 8",
          locations: { cfi: "epubcfi(/6/16!/4/2:0)", totalProgression: 0.8 },
        },
      });

      const manager = createManager();
      const result = await manager.syncBook(bookId, { isColdOpen: true });

      expect(result.action).toBe("pulled");
      expect(conflictPromptCalls.length).toBe(0); // No conflict prompt on cold open!
      expect(progressStore.get(bookId)?.progression).toBe(0.8);
      expect(syncStateStore.get(bookId)?.syncStatus).toBe("synced");
    });

    it("Case C4: Triggers conflict prompt when remote is newer during active session", async () => {
      progressStore.set(bookId, {
        bookId,
        progression: 0.3,
        locator: "epubcfi(/6/6!/4/2:0)",
        modifiedAt: "2026-10-05T12:00:00Z", // Older
      });

      vi.mocked(mockClient.getProgression).mockResolvedValueOnce({
        modified: "2026-10-07T12:00:00Z", // Newer
        device: "educk-tablet",
        locator: {
          title: "Chapter 8",
          locations: { cfi: "epubcfi(/6/16!/4/2:0)", totalProgression: 0.85 },
        },
      });

      const manager = createManager();
      const result = await manager.syncBook(bookId, { isSessionActive: true });

      expect(result.action).toBe("conflict");
      expect(conflictPromptCalls.length).toBe(1);
      expect(conflictPromptCalls[0].bookId).toBe(bookId);
      expect(conflictPromptCalls[0].remoteProgression).toBe(0.85);
      expect(conflictPromptCalls[0].localProgression).toBe(0.3);

      expect(syncStateStore.get(bookId)?.syncStatus).toBe("conflict");
    });

    it("resolves conflict with 'apply_remote'", async () => {
      progressStore.set(bookId, {
        bookId,
        progression: 0.3,
        locator: "epubcfi(/6/6!/4/2:0)",
        modifiedAt: "2026-10-05T12:00:00Z",
      });

      vi.mocked(mockClient.getProgression).mockResolvedValueOnce({
        modified: "2026-10-07T12:00:00Z",
        device: "educk-tablet",
        locator: {
          title: "Chapter 8",
          locations: { cfi: "epubcfi(/6/16!/4/2:0)", totalProgression: 0.85 },
        },
      });

      const manager = createManager();
      await manager.syncBook(bookId, { isSessionActive: true });

      const resolveResult = await manager.resolveConflict(bookId, "apply_remote");
      expect(resolveResult.action).toBe("pulled");
      expect(progressStore.get(bookId)?.progression).toBe(0.85);
      expect(syncStateStore.get(bookId)?.syncStatus).toBe("synced");
    });

    it("resolves conflict with 'keep_local'", async () => {
      progressStore.set(bookId, {
        bookId,
        progression: 0.3,
        locator: "epubcfi(/6/6!/4/2:0)",
        modifiedAt: "2026-10-05T12:00:00Z",
      });

      vi.mocked(mockClient.getProgression).mockResolvedValueOnce({
        modified: "2026-10-07T12:00:00Z",
        device: "educk-tablet",
        locator: {
          locations: { cfi: "epubcfi(/6/16!/4/2:0)", totalProgression: 0.85 },
        },
      });

      const manager = createManager();
      await manager.syncBook(bookId, { isSessionActive: true });

      const resolveResult = await manager.resolveConflict(bookId, "keep_local");
      expect(resolveResult.action).toBe("pushed");
      expect(mockClient.putProgression).toHaveBeenCalled();
      expect(syncStateStore.get(bookId)?.syncStatus).toBe("synced");
    });

    it("handles network failure gracefully by queueing book with pending status", async () => {
      vi.mocked(mockClient.getProgression).mockRejectedValueOnce(
        new Error("Network connection dropped"),
      );

      const manager = createManager();
      const result = await manager.syncBook(bookId);

      expect(result.action).toBe("error");
      expect(result.error).toContain("Network connection dropped");
      expect(errorCalls.length).toBe(1);
      expect(syncStateStore.get(bookId)?.syncStatus).toBe("pending");
    });

    it("syncQueue processes all queued pending sync items", async () => {
      syncStateStore.set("book-pending-1", {
        bookId: "book-pending-1",
        localVersion: 1,
        syncStatus: "pending",
      });
      settingsStore.set("progression.url.book-pending-1", "https://catalog.example/progression/1");
      progressStore.set("book-pending-1", {
        bookId: "book-pending-1",
        progression: 0.1,
        locator: "epubcfi(/6/2!/4:0)",
        modifiedAt: "2026-10-08T00:00:00Z",
      });

      vi.mocked(mockClient.getProgression).mockResolvedValueOnce(null);

      const manager = createManager();
      const results = await manager.syncQueue();

      expect(results.length).toBe(1);
      expect(results[0].action).toBe("pushed");
      expect(syncStateStore.get("book-pending-1")?.syncStatus).toBe("synced");
    });
  });
});
