/**
 * BookFlow Compatibility & Interoperability Test Suite
 *
 * Verifies end-to-end compatibility between educk and syfq91/bookflow
 * (Flask-based OPDS 1.2 catalog and OPDS Progression 1.0 synchronization server).
 *
 * References:
 * - BookFlow specification: https://github.com/syfq91/bookflow/blob/main/REFERENCE.md
 * - BookFlow OPDS generator: https://github.com/syfq91/bookflow/blob/main/src/bookflow/opds/generator.py
 * - BookFlow Progression service: https://github.com/syfq91/bookflow/blob/main/src/bookflow/opds/progression.py
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createOPDSClient } from "../../src/services/opds/opds-client.ts";
import {
  createProgressionClient,
  ProgressionConflictError,
} from "../../src/services/progression/progression-client.ts";
import { ProgressionSyncManager } from "../../src/services/progression/progression-sync-manager.ts";
import type {
  BookRepository,
  ProgressRepository,
  ReadingProgress,
  SettingsRepository,
  SourceRepository,
  SyncState,
  SyncStateRepository,
} from "../../src/domain/database.ts";
import type { ProgressionConflict } from "../../src/domain/progression.ts";

// Sample feeds matching BookFlow's exact ElementTree serialization output
const BOOKFLOW_ROOT_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>BookFlow</title>
  <id>tag:bookflow,/opds</id>
  <updated>2026-01-27T11:00:00Z</updated>
  <link rel="self" href="/opds" type="application/atom+xml;profile=opds-catalog;kind=navigation" />
  <link rel="search" href="/opds/search?q={searchTerms}" type="application/atom+xml;profile=opds-catalog;kind=acquisition" title="Search" />
  <entry>
    <id>tag:bookflow,folder,1</id>
    <title>books</title>
    <updated>2026-01-27T11:00:00Z</updated>
    <link rel="subsection" href="/opds/folders/1" type="application/atom+xml;profile=opds-catalog;kind=acquisition" />
  </entry>
  <entry>
    <id>tag:bookflow,all-books</id>
    <title>All Books</title>
    <updated>2026-01-27T11:00:00Z</updated>
    <link rel="subsection" href="/opds/books" type="application/atom+xml;profile=opds-catalog;kind=acquisition" />
  </entry>
  <entry>
    <id>tag:bookflow,recent</id>
    <title>Recent</title>
    <updated>2026-01-27T11:00:00Z</updated>
    <link rel="subsection" href="/opds/recent" type="application/atom+xml;profile=opds-catalog;kind=acquisition" />
  </entry>
  <entry>
    <id>tag:bookflow,authors</id>
    <title>Authors</title>
    <updated>2026-01-27T11:00:00Z</updated>
    <link rel="subsection" href="/opds/authors" type="application/atom+xml;profile=opds-catalog;kind=navigation" />
  </entry>
  <entry>
    <id>tag:bookflow,catalog,x3</id>
    <title>X3 Catalog</title>
    <updated>2026-01-27T11:00:00Z</updated>
    <link rel="subsection" href="/opdsx3" type="application/atom+xml;profile=opds-catalog;kind=navigation" />
  </entry>
  <entry>
    <id>tag:bookflow,catalog,x4</id>
    <title>X4 Catalog</title>
    <updated>2026-01-27T11:00:00Z</updated>
    <link rel="subsection" href="/opdsx4" type="application/atom+xml;profile=opds-catalog;kind=navigation" />
  </entry>
</feed>`;

const BOOKFLOW_ACQUISITION_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>BookFlow — All Books</title>
  <id>tag:bookflow,/opds/books</id>
  <updated>2026-01-27T11:00:00Z</updated>
  <link rel="self" href="/opds/books" type="application/atom+xml;profile=opds-catalog;kind=acquisition" />
  <link rel="search" href="/opds/search?q={searchTerms}" type="application/atom+xml;profile=opds-catalog;kind=acquisition" title="Search" />
  <link rel="next" href="/opds/books?page=2" type="application/atom+xml;profile=opds-catalog;kind=acquisition" />
  <entry>
    <id>tag:bookflow,2026-01-27,book/1</id>
    <title>Dune</title>
    <updated>2026-01-27T11:00:00Z</updated>
    <author>
      <name>Frank Herbert</name>
    </author>
    <summary>Set on the desert planet Arrakis, Dune tells the story of Paul Atreides.</summary>
    <link rel="http://opds-spec.org/acquisition" href="/opds/download/1" type="application/epub+zip" title="Download" />
    <link rel="http://opds-spec.org/image/thumbnail" href="/opds/cover/1" type="image/jpeg" />
    <link rel="http://opds-spec.org/image" href="/opds/cover/1" type="image/jpeg" />
    <link rel="http://opds-spec.org/progression" href="/opds/publications/1/progression" type="application/opds-progression+json" />
  </entry>
</feed>`;

describe("BookFlow OPDS & Progression Compatibility", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("OPDS 1.2 Catalog Compatibility", () => {
    it("parses BookFlow root navigation feed and detects server profile as bookflow", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/atom+xml;profile=opds-catalog;kind=navigation" }),
        text: async () => BOOKFLOW_ROOT_FEED,
      });

      const client = createOPDSClient();
      const feed = await client.fetchFeed("http://192.168.1.50:8000/opds");

      expect(feed.title).toBe("BookFlow");
      expect(feed.serverProfile).toBe("bookflow");
      expect(feed.entries.length).toBe(6);

      // Verify search link
      const searchLink = client.getSearchLink(feed);
      expect(searchLink).toBeDefined();
      expect(searchLink?.href).toBe("http://192.168.1.50:8000/opds/search?q={searchTerms}");

      // Verify folder and catalog section navigation entries
      const titles = feed.entries.map((e) => e.title);
      expect(titles).toContain("books");
      expect(titles).toContain("All Books");
      expect(titles).toContain("Recent");
      expect(titles).toContain("Authors");
      expect(titles).toContain("X3 Catalog");
      expect(titles).toContain("X4 Catalog");
    });

    it("parses BookFlow acquisition feed with EPUB download, cover, and progression links", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/atom+xml;profile=opds-catalog;kind=acquisition" }),
        text: async () => BOOKFLOW_ACQUISITION_FEED,
      });

      const client = createOPDSClient();
      const feed = await client.fetchFeed("http://192.168.1.50:8000/opds/books");

      expect(feed.title).toBe("BookFlow — All Books");
      expect(feed.entries.length).toBe(1);

      const entry = feed.entries[0];
      expect(entry.title).toBe("Dune");
      expect(entry.authors[0].name).toBe("Frank Herbert");
      expect(entry.summary).toContain("desert planet Arrakis");

      // Verify acquisition link resolution
      const acqLinks = client.getAcquisitionLinks(entry);
      expect(acqLinks.length).toBe(1);
      expect(acqLinks[0].href).toBe("http://192.168.1.50:8000/opds/download/1");
      expect(acqLinks[0].type).toBe("application/epub+zip");

      // Verify cover links
      const coverLink = client.getCoverLink(entry);
      const thumbLink = client.getThumbnailLink(entry);
      expect(coverLink?.href).toBe("http://192.168.1.50:8000/opds/cover/1");
      expect(thumbLink?.href).toBe("http://192.168.1.50:8000/opds/cover/1");

      // Verify OPDS progression discovery link
      const progressionLink = client.getProgressionLink(entry);
      expect(progressionLink).toBeDefined();
      expect(progressionLink?.href).toBe("http://192.168.1.50:8000/opds/publications/1/progression");
      expect(progressionLink?.type).toBe("application/opds-progression+json");

      // Verify pagination
      const nextLink = client.getNextPageLink(feed);
      expect(nextLink).toBeDefined();
      expect(nextLink?.href).toBe("http://192.168.1.50:8000/opds/books?page=2");
    });
  });

  describe("OPDS Progression 1.0 Client Interoperability", () => {
    it("fetches and normalizes BookFlow progression response document", async () => {
      const bookflowResponse = {
        modified: "2026-01-27T11:00:00Z",
        progression: 0.155,
        device: { id: "urn:uuid:019c0047-cc8d-7ec4-a3c3-938ccadc020a", name: "KOReader" },
        title: "Chapter 3 - The Gom Jabbar",
        references: ["chapter3.xhtml"],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(bookflowResponse),
      });

      const client = createProgressionClient({ retryDelay: 10 });
      const payload = await client.getProgression("http://192.168.1.50:8000/opds/publications/1/progression");

      expect(payload).not.toBeNull();
      expect(payload?.modified).toBe("2026-01-27T11:00:00Z");
      expect(payload?.device).toBe("urn:uuid:019c0047-cc8d-7ec4-a3c3-938ccadc020a");
      expect(payload?.progression).toBe(0.155);
      expect(payload?.locator.locations.totalProgression).toBe(0.155);
      expect(payload?.locator.href).toBe("chapter3.xhtml");
      expect(payload?.locator.title).toBe("Chapter 3 - The Gom Jabbar");
    });

    it("returns null when BookFlow answers unread publications with 200 and empty body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      const client = createProgressionClient({ retryDelay: 10 });
      const payload = await client.getProgression("http://192.168.1.50:8000/opds/publications/2/progression");

      expect(payload).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("sends PUT payload with application/opds-progression+json Content-Type, device object, and progression", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      });

      const client = createProgressionClient({ deviceId: "educk-uuid-123", retryDelay: 10 });
      const success = await client.putProgression(
        "http://192.168.1.50:8000/opds/publications/1/progression",
        {
          modified: "2026-02-01T14:30:00Z",
          device: "educk-uuid-123",
          progression: 0.35,
          title: "Chapter 5",
          references: ["text/chapter05.xhtml"],
          locator: {
            href: "text/chapter05.xhtml",
            title: "Chapter 5",
            locations: {
              cfi: "epubcfi(/6/10[c05]!/4/2)",
              progression: 0.35,
              totalProgression: 0.35,
            },
          },
        },
      );

      expect(success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("http://192.168.1.50:8000/opds/publications/1/progression");
      expect(init.method).toBe("PUT");
      // Critical BookFlow requirement: must be application/opds-progression+json
      expect(init.headers["Content-Type"]).toBe("application/opds-progression+json");
      expect(init.headers["Accept"]).toContain("application/opds-progression+json");

      const body = JSON.parse(init.body);
      expect(body.modified).toBe("2026-02-01T14:30:00Z");
      expect(body.progression).toBe(0.35);
      expect(body.device).toEqual({ id: "educk-uuid-123", name: "educk Reader" });
      expect(body.title).toBe("Chapter 5");
      expect(body.references).toEqual(["text/chapter05.xhtml"]);
    });

    it("detects BookFlow HTTP 409 conflict and throws ProgressionConflictError without retrying", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: "Conflict",
        headers: new Headers({ "content-type": "application/problem+json" }),
        text: async () => JSON.stringify({
          type: "https://registry.opds.io/error#progression-date",
          title: "A newer progression is already stored.",
        }),
      });

      const client = createProgressionClient({ maxRetries: 3, retryDelay: 5 });
      await expect(
        client.putProgression("http://192.168.1.50:8000/opds/publications/1/progression", {
          modified: "2026-01-20T10:00:00Z",
          device: "educk-uuid-123",
          locator: {
            locations: { totalProgression: 0.1 },
          },
        }),
      ).rejects.toThrow(ProgressionConflictError);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("End-to-End ProgressionSyncManager Interoperability with BookFlow", () => {
    let mockProgressRepo: ProgressRepository;
    let mockSyncStateRepo: SyncStateRepository;
    let mockSettingsRepo: SettingsRepository;
    let mockBookRepo: BookRepository;
    let mockSourceRepo: SourceRepository;

    let progressStore: Map<string, ReadingProgress>;
    let syncStateStore: Map<string, SyncState>;
    let settingsStore: Map<string, string>;

    beforeEach(() => {
      progressStore = new Map();
      syncStateStore = new Map();
      settingsStore = new Map();

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
        findPendingSync: vi.fn(async () => Array.from(syncStateStore.values())),
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
        findById: vi.fn(async () => ({
          id: "book-1",
          title: "Dune",
          sourceId: "source-bookflow",
          localPath: "/data/books/book-1/book.epub",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        })),
        findByLocalPath: vi.fn(async () => null),
        findAll: vi.fn(async () => []),
        insert: vi.fn(async () => {}),
        update: vi.fn(async () => {}),
        updateLastOpened: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
      };

      mockSourceRepo = {
        findById: vi.fn(async () => ({
          id: "source-bookflow",
          name: "My BookFlow Server",
          url: "http://192.168.1.50:8000/opds",
          authType: "basic",
          username: "admin",
          authData: "secretpass",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        })),
        findAll: vi.fn(async () => []),
        insert: vi.fn(async () => {}),
        update: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
      };
    });

    it("handles initial cold open pull from BookFlow", async () => {
      const bookflowStoredDoc = {
        modified: "2026-02-01T08:00:00Z",
        progression: 0.22,
        device: { id: "urn:uuid:koreader-device", name: "KOReader" },
        title: "Chapter 4",
        references: ["chapter04.xhtml"],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(bookflowStoredDoc),
      });

      const client = createProgressionClient({ retryDelay: 5 });
      const manager = new ProgressionSyncManager({
        progressRepo: mockProgressRepo,
        syncStateRepo: mockSyncStateRepo,
        settingsRepo: mockSettingsRepo,
        bookRepo: mockBookRepo,
        sourceRepo: mockSourceRepo,
        client,
      });

      await manager.registerProgressionUrl("book-1", "http://192.168.1.50:8000/opds/publications/1/progression");
      const result = await manager.syncBook("book-1", { isColdOpen: true });

      expect(result.action).toBe("pulled");
      const saved = progressStore.get("book-1");
      expect(saved).toBeDefined();
      expect(saved?.progression).toBe(0.22);
      expect(saved?.href).toBe("chapter04.xhtml");
      expect(saved?.chapterTitle).toBe("Chapter 4");
    });

    it("pushes local progress to BookFlow and handles 409 conflict seamlessly", async () => {
      // Local progress is at 0.40 but local timestamp is stale compared to server's newer 0.65
      progressStore.set("book-1", {
        bookId: "book-1",
        progression: 0.40,
        locator: "epubcfi(/6/12!/4/2)",
        href: "chapter06.xhtml",
        chapterTitle: "Chapter 6",
        modifiedAt: "2026-01-28T10:00:00Z",
        syncedAt: null,
      });

      // 1. PUT returns 409 Conflict
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: "Conflict",
        text: async () => JSON.stringify({
          type: "https://registry.opds.io/error#progression-date",
          title: "A newer progression is already stored.",
        }),
      });

      // 2. GET returns newer BookFlow document
      const newerServerDoc = {
        modified: "2026-01-30T15:00:00Z",
        progression: 0.65,
        device: { id: "urn:uuid:other-phone", name: "Phone" },
        title: "Chapter 10",
        references: ["chapter10.xhtml"],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(newerServerDoc),
      });

      let promptConflict: ProgressionConflict | undefined;
      const client = createProgressionClient({ retryDelay: 5 });
      const manager = new ProgressionSyncManager({
        progressRepo: mockProgressRepo,
        syncStateRepo: mockSyncStateRepo,
        settingsRepo: mockSettingsRepo,
        bookRepo: mockBookRepo,
        sourceRepo: mockSourceRepo,
        client,
        callbacks: {
          onConflictPrompt: (c) => {
            promptConflict = c;
          },
        },
      });

      await manager.registerProgressionUrl("book-1", "http://192.168.1.50:8000/opds/publications/1/progression");
      const result = await manager.syncBook("book-1");

      expect(result.action).toBe("conflict");
      expect(promptConflict).toBeDefined();
      expect(promptConflict?.localProgression).toBe(0.40);
      expect(promptConflict?.remoteProgression).toBe(0.65);
      expect(promptConflict?.remoteTitle).toBe("Chapter 10");
    });
  });
});
