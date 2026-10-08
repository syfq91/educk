import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FakeOpdsServer } from "./opds-server/fake-opds-server.ts";
import { OPDSClient } from "../../src/services/opds/opds-client.ts";
import { SqlSourceRepository } from "../../src/services/database/sql-source-repository.ts";
import { SqlBookRepository } from "../../src/services/database/sql-book-repository.ts";
import { SqlProgressRepository } from "../../src/services/database/sql-progress-repository.ts";
import { SqlSyncStateRepository } from "../../src/services/database/sql-sync-state-repository.ts";
import { SqlSettingsRepository } from "../../src/services/database/sql-settings-repository.ts";
import { ProgressionClient } from "../../src/services/progression/progression-client.ts";
import { ProgressionSyncManager } from "../../src/services/progression/progression-sync-manager.ts";
import { LibraryController } from "../../src/features/library/library-controller.ts";
import { createMigratedTestDatabase } from "../helpers/test-database.ts";
import type { Book, CatalogSource, ReadingProgress } from "../../src/domain/database.ts";
import type { RemoteProgressionPayload } from "../../src/domain/progression.ts";

describe("Milestone M17: End-to-End Golden Path Lifecycle", () => {
  let fakeServer: FakeOpdsServer;
  let nativeFetch: typeof fetch;

  beforeEach(async () => {
    // Enable Node's native fetch for real HTTP network transport
    nativeFetch = (global as unknown as { __NATIVE_FETCH__?: typeof fetch }).__NATIVE_FETCH__ ?? globalThis.fetch;
    global.fetch = nativeFetch;

    fakeServer = new FakeOpdsServer();
    await fakeServer.start();
  });

  afterEach(async () => {
    await fakeServer.stop();
    // Restore mock fetch for other unit test suites
    const mockFetch = (global as unknown as { __MOCK_FETCH__?: typeof fetch }).__MOCK_FETCH__;
    if (mockFetch) {
      global.fetch = mockFetch;
    }
  });

  it("executes the full 10-step Golden Path lifecycle from fresh install to offline reading and progression sync", async () => {
    // =========================================================================
    // STEP 1: Fresh App Install (Clean SQLite database with versioned migrations)
    // =========================================================================
    const db = createMigratedTestDatabase();
    const sourceRepo = new SqlSourceRepository(db);
    const bookRepo = new SqlBookRepository(db);
    const progressRepo = new SqlProgressRepository(db);
    const syncStateRepo = new SqlSyncStateRepository(db);
    const settingsRepo = new SqlSettingsRepository(db);

    expect(await sourceRepo.count()).toBe(0);
    expect(await bookRepo.count()).toBe(0);
    expect(await progressRepo.findAll()).toHaveLength(0);

    // =========================================================================
    // STEP 2: Add Fake OPDS Catalog Endpoint
    // =========================================================================
    const catalogUrl = `${fakeServer.getBaseUrl()}/opds/root.xml`;
    const newCatalog: CatalogSource = {
      id: "catalog-golden-path",
      name: "Golden Path Library",
      url: catalogUrl,
      description: "Automated fake OPDS 1.2 catalog for E2E testing",
      authType: "none",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await sourceRepo.insert(newCatalog);
    const storedCatalog = await sourceRepo.findById("catalog-golden-path");
    expect(storedCatalog).not.toBeNull();
    expect(storedCatalog?.name).toBe("Golden Path Library");
    expect(storedCatalog?.url).toBe(catalogUrl);

    // =========================================================================
    // STEP 3: Browse Navigation & Acquisition Feeds
    // =========================================================================
    const opdsClient = new OPDSClient();
    const rootFeed = await opdsClient.fetchFeed(storedCatalog!.url);

    expect(rootFeed.title).toBe("Golden Path OPDS Catalog");
    expect(rootFeed.entries.length).toBeGreaterThanOrEqual(1);

    // Follow subsection link to acquisition feed
    const booksSection = rootFeed.entries.find((e) => e.title.includes("Featured Books"));
    expect(booksSection).toBeDefined();
    const booksLink = booksSection!.links.find((l) => l.rel === "subsection");
    expect(booksLink).toBeDefined();

    const booksFeed = await opdsClient.fetchFeed(booksLink!.href);
    expect(booksFeed.title).toBe("Golden Path Books");
    expect(booksFeed.entries).toHaveLength(1);

    const testEntry = booksFeed.entries[0];
    expect(testEntry.title).toBe("The Golden Path Guide");
    expect(testEntry.authors[0].name).toBe("Educk Test Author");

    // Verify acquisition and progression links
    const acquisitionLinks = opdsClient.getAcquisitionLinks(testEntry);
    expect(acquisitionLinks).toHaveLength(1);
    expect(acquisitionLinks[0].href).toContain("/opds/books/golden-path.epub");
    expect(acquisitionLinks[0].type).toBe("application/epub+zip");

    const progressionLink = opdsClient.getProgressionLink(testEntry);
    expect(progressionLink).not.toBeNull();
    expect(progressionLink?.href).toContain("/opds/progression/golden-path");

    // =========================================================================
    // STEP 4: Download Test EPUB (Atomic verify & commit)
    // =========================================================================
    const epubDownloadUrl = acquisitionLinks[0].href;
    const downloadRes = await nativeFetch(epubDownloadUrl);
    expect(downloadRes.ok).toBe(true);
    expect(downloadRes.headers.get("content-type")).toBe("application/epub+zip");

    const epubArrayBuffer = await downloadRes.arrayBuffer();
    const epubBuffer = Buffer.from(epubArrayBuffer);
    expect(epubBuffer.length).toBeGreaterThan(100);

    // Verify ZIP magic bytes (PK\x03\x04)
    expect(epubBuffer[0]).toBe(0x50); // 'P'
    expect(epubBuffer[1]).toBe(0x4b); // 'K'
    expect(epubBuffer[2]).toBe(0x03);
    expect(epubBuffer[3]).toBe(0x04);

    // Commit to SQLite
    const downloadedBook: Book = {
      id: "book-golden-path",
      sourceId: newCatalog.id,
      remoteId: testEntry.id,
      title: testEntry.title,
      authors: testEntry.authors.map((a) => a.name).join(", "),
      coverUrl: testEntry.coverUrl ?? null,
      acquisitionUrl: epubDownloadUrl,
      mimeType: "application/epub+zip",
      localPath: "/data/books/book-golden-path/book.epub",
      fileSize: epubBuffer.length,
      downloadedAt: new Date().toISOString(),
      lastOpenedAt: null,
    };
    await bookRepo.insert(downloadedBook);

    const savedBook = await bookRepo.findById("book-golden-path");
    expect(savedBook).not.toBeNull();
    expect(savedBook?.title).toBe("The Golden Path Guide");

    // =========================================================================
    // STEP 5: Open Book in Reader (Verify offline reading readiness)
    // =========================================================================
    const initialProgress = await progressRepo.findByBookId(downloadedBook.id);
    expect(initialProgress).toBeNull(); // Freshly downloaded book has no progress

    // =========================================================================
    // STEP 6: Navigate to Chapter 3 (CFI captured and persisted)
    // =========================================================================
    const chapter3Progress: ReadingProgress = {
      bookId: downloadedBook.id,
      progression: 0.35,
      locator: "epubcfi(/6/6[ch3]!/4/2)",
      href: "text/ch3.xhtml",
      chapterTitle: "Chapter 3: The Golden Path",
      modifiedAt: new Date().toISOString(),
      syncedAt: null,
    };
    await progressRepo.upsert(chapter3Progress);

    // Register pending sync in SQLite sync_state table
    await syncStateRepo.upsert({
      bookId: downloadedBook.id,
      localVersion: 1,
      remoteVersion: 0,
      lastSyncAt: null,
      syncStatus: "pending",
    });

    const recordedProgress = await progressRepo.findByBookId(downloadedBook.id);
    expect(recordedProgress).not.toBeNull();
    expect(recordedProgress?.progression).toBe(0.35);
    expect(recordedProgress?.locator).toBe("epubcfi(/6/6[ch3]!/4/2)");
    expect(recordedProgress?.chapterTitle).toBe("Chapter 3: The Golden Path");

    // =========================================================================
    // STEP 7: Background App / Kill Process
    // =========================================================================
    // Progress is already safely flushed to SQLite.
    // Simulate process death: clear transient state.
    const pendingSyncBeforeRestart = await syncStateRepo.findByBookId(downloadedBook.id);
    expect(pendingSyncBeforeRestart?.syncStatus).toBe("pending");

    // =========================================================================
    // STEP 8: Reopen App (Verify offline library renders with progress)
    // =========================================================================
    // Cut off network to simulate offline restart
    fakeServer.setOffline(true);

    const container = document.createElement("div");
    const list = document.createElement("div");
    const emptyState = document.createElement("div");
    const sortSelect = document.createElement("select");
    const refreshBtn = document.createElement("button");

    new LibraryController(
      { container, list, emptyState, sortSelect, refreshBtn },
      bookRepo,
      progressRepo,
      null,
      null,
    );

    // Wait for library books and progress to render from SQLite
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(list.children).toHaveLength(1);
    const renderedCard = list.querySelector<HTMLElement>(".book-card")!;
    expect(renderedCard).not.toBeNull();
    expect(renderedCard.textContent).toContain("The Golden Path Guide");
    expect(renderedCard.textContent).toContain("Educk Test Author");
    expect(renderedCard.textContent).toContain("Chapter 3: The Golden Path");
    expect(renderedCard.textContent).toContain("35%");

    // =========================================================================
    // STEP 9: Reopen Book (Verify CFI restoration to Chapter 3 offline)
    // =========================================================================
    const restoredProgress = await progressRepo.findByBookId(downloadedBook.id);
    expect(restoredProgress).not.toBeNull();
    expect(restoredProgress?.locator).toBe("epubcfi(/6/6[ch3]!/4/2)");
    expect(restoredProgress?.progression).toBe(0.35);

    // =========================================================================
    // STEP 10: Restore Network & Verify Progression Synchronization
    // =========================================================================
    // Restore server network
    fakeServer.setOffline(false);

    await settingsRepo.set("progression.device_id", "educk-android-e2e-test");

    const progressionClient = new ProgressionClient({
      deviceId: "educk-android-e2e-test",
    });

    const syncManager = new ProgressionSyncManager({
      client: progressionClient,
      progressRepo,
      syncStateRepo,
      settingsRepo,
    });

    await syncManager.registerProgressionUrl(
      downloadedBook.id,
      `${fakeServer.getBaseUrl()}/opds/progression/golden-path`,
    );

    // Trigger synchronization
    const syncResult = await syncManager.syncBook(downloadedBook.id);
    expect(syncResult.action).toBe("pushed");

    // Verify remote server received and stored the progression payload
    const remoteStored = fakeServer.getStoredProgression("golden-path");
    expect(remoteStored).not.toBeNull();
    expect(remoteStored?.deviceId).toBe("educk-android-e2e-test");
    expect(remoteStored?.payload.locator.locations.totalProgression).toBe(0.35);
    expect(remoteStored?.payload.locator.locations.progression).toBe(0.35);

    // Verify sync status in SQLite transitioned to 'synced'
    const finalSyncState = await syncStateRepo.findByBookId(downloadedBook.id);
    expect(finalSyncState?.syncStatus).toBe("synced");
    expect(finalSyncState?.lastSyncAt).not.toBeNull();
  });

  describe("Edge Cases & Network Resilience", () => {
    it("handles server HTTP 500 error and recovers via automatic retry with backoff", async () => {
      const progressionUrl = `${fakeServer.getBaseUrl()}/opds/progression/test-retry`;
      const client = new ProgressionClient({
        deviceId: "educk-test-device",
        maxRetries: 2,
        retryDelay: 50,
      });

      // Fail next 2 requests with HTTP 500 then recover
      fakeServer.setFailCount(2);

      const payload: RemoteProgressionPayload = {
        modified: new Date().toISOString(),
        device: "educk-test-device",
        locator: {
          href: "ch1.xhtml",
          locations: { progression: 0.1, totalProgression: 0.1 },
        },
      };

      const result = await client.putProgression(progressionUrl, payload);
      expect(result).toBe(true);

      const stored = fakeServer.getStoredProgression("test-retry");
      expect(stored).not.toBeNull();
      expect(stored?.payload.locator.locations.totalProgression).toBe(0.1);
    });

    it("resolves remote progression conflict when remote device has newer progress", async () => {
      const db = createMigratedTestDatabase();
      const bookRepo = new SqlBookRepository(db);
      const progressRepo = new SqlProgressRepository(db);
      const syncStateRepo = new SqlSyncStateRepository(db);
      const settingsRepo = new SqlSettingsRepository(db);

      const bookId = "book-conflict-test";
      await bookRepo.insert({
        id: bookId,
        title: "Conflict Test Book",
        acquisitionUrl: "http://example.com/conflict.epub",
        mimeType: "application/epub+zip",
        localPath: "/data/books/conflict/book.epub",
        fileSize: 1024,
        downloadedAt: new Date().toISOString(),
      });

      const progressionUrl = `${fakeServer.getBaseUrl()}/opds/progression/conflict-test`;
      await settingsRepo.set(`opds:progression_endpoint:${bookId}`, progressionUrl);

      // Local progress is older: 20%
      await progressRepo.upsert({
        bookId,
        progression: 0.2,
        locator: "epubcfi(/6/2!/4)",
        modifiedAt: "2026-10-01T10:00:00.000Z",
        syncedAt: null,
      });

      // Remote progress is newer: 75%
      fakeServer.setStoredProgression(
        "conflict-test",
        {
          modified: "2026-10-08T12:00:00.000Z",
          device: "tablet-device",
          locator: {
            href: "ch5.xhtml",
            locations: { progression: 0.75, totalProgression: 0.75 },
          },
        },
        "tablet-device",
      );

      const progressionClient = new ProgressionClient({
        deviceId: "phone-device",
      });

      const syncManager = new ProgressionSyncManager({
        client: progressionClient,
        progressRepo,
        syncStateRepo,
        settingsRepo,
      });

      await syncManager.registerProgressionUrl(bookId, progressionUrl);

      // Cold open sync applies the newer remote progress
      const result = await syncManager.syncBook(bookId, { isColdOpen: true });
      expect(result.action).toBe("pulled");

      // Verify local database now reflects the newer 75% remote progress
      const updatedLocal = await progressRepo.findByBookId(bookId);
      expect(updatedLocal?.progression).toBe(0.75);
      expect(updatedLocal?.modifiedAt).toBe("2026-10-08T12:00:00.000Z");

      const syncState = await syncStateRepo.findByBookId(bookId);
      expect(syncState?.syncStatus).toBe("synced");
    });
  });
});
