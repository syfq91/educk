import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { OPDSClient } from "../../src/services/opds/opds-client.ts";

describe("Milestone M15: Real-World Server Compatibility & Fixture Verification", () => {
  const fixturesDir = path.resolve(__dirname, "../../fixtures/opds");

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const loadFixture = (filename: string): string => {
    return fs.readFileSync(path.join(fixturesDir, filename), "utf-8");
  };

  const setupMockFetch = (xmlContent: string) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/atom+xml" }),
        text: vi.fn().mockResolvedValue(xmlContent),
      }),
    );
  };

  describe("Calibre-Web Server Compatibility", () => {
    it("successfully parses Calibre-Web feed and normalizes quirks", async () => {
      const xml = loadFixture("calibre-web.xml");
      setupMockFetch(xml);

      const client = new OPDSClient();
      const feed = await client.fetchFeed("https://library.local/opds/");

      // Verify server profile detection
      expect(feed.serverProfile).toBe("calibre-web");
      expect(feed.title).toBe("Calibre-Web OPDS Catalog");
      expect(feed.entries).toHaveLength(2);

      // Entry 1: Foundation and Empire
      const entry1 = feed.entries[0];
      expect(entry1.title).toBe("Foundation and Empire");
      expect(entry1.authors).toHaveLength(1);
      expect(entry1.authors[0].name).toBe("Isaac Asimov");
      expect(entry1.published).toBe("1952-04-01T00:00:00+00:00");
      expect(entry1["dcterms:publisher"]).toBe("Spectra");

      // Verify MIME type normalization from application/x-epub+zip
      const acq1 = client.getAcquisitionLinks(entry1);
      expect(acq1).toHaveLength(1);
      expect(acq1[0].type).toBe("application/epub+zip");
      expect(acq1[0].href).toBe("https://library.local/opds/download/101/epub/Foundation_and_Empire.epub");

      // Verify cover and thumbnail
      expect(client.getCoverLink(entry1)?.href).toBe("https://library.local/opds/cover/101");
      expect(client.getThumbnailLink(entry1)?.href).toBe("https://library.local/opds/thumbnail/101");

      // Entry 2: Good Omens (multi-author splitting and shorthand rels)
      const entry2 = feed.entries[1];
      expect(entry2.title).toBe("Good Omens");
      expect(entry2.authors).toHaveLength(2);
      expect(entry2.authors[0].name).toBe("Neil Gaiman");
      expect(entry2.authors[1].name).toBe("Terry Pratchett");

      // Shorthand rel="acquisition" normalized to OPDS URI
      const acq2 = client.getAcquisitionLinks(entry2);
      expect(acq2).toHaveLength(1);
      expect(acq2[0].rel).toBe("http://opds-spec.org/acquisition");

      // Shorthand rel="cover" and rel="thumbnail"
      expect(client.getCoverLink(entry2)?.rel).toBe("http://opds-spec.org/image");
      expect(client.getThumbnailLink(entry2)?.rel).toBe("http://opds-spec.org/image/thumbnail");
    });
  });

  describe("Komga Server Compatibility", () => {
    it("successfully parses Komga feed with pagination and MIME inference", async () => {
      const xml = loadFixture("komga.xml");
      setupMockFetch(xml);

      const client = new OPDSClient();
      const feed = await client.fetchFeed("https://komga.local/opds/v1.2/series/0ABC123/books");

      // Server profile
      expect(feed.serverProfile).toBe("komga");
      expect(feed.totalResults).toBe(42);
      expect(feed.itemsPerPage).toBe(20);

      // Pagination
      const nextLink = client.getNextPageLink(feed);
      expect(nextLink).not.toBeNull();
      expect(nextLink?.href).toBe("https://komga.local/opds/v1.2/series/0ABC123/books?page=1&size=20");

      expect(feed.entries).toHaveLength(2);

      // Entry 2: Generic octet-stream MIME type inferred from .epub extension
      const entry2 = feed.entries[1];
      const acq2 = client.getAcquisitionLinks(entry2);
      expect(acq2).toHaveLength(1);
      expect(acq2[0].type).toBe("application/epub+zip");

      // Legacy image/x-png normalized to image/png
      const cover2 = client.getCoverLink(entry2);
      expect(cover2).not.toBeNull();
      expect(cover2?.type).toBe("image/png");
    });
  });

  describe("Kavita Server Compatibility", () => {
    it("successfully parses Kavita feed with unwrapped author tags and uppercase MIMEs", async () => {
      const xml = loadFixture("kavita.xml");
      setupMockFetch(xml);

      const client = new OPDSClient();
      const feed = await client.fetchFeed("https://kavita.local/api/opds/series/42");

      expect(feed.serverProfile).toBe("kavita");
      expect(feed.entries).toHaveLength(2);

      // Entry 1: Unwrapped author tag
      const entry1 = feed.entries[0];
      expect(entry1.authors).toHaveLength(1);
      expect(entry1.authors[0].name).toBe("Miya Kazuki");

      // Uppercase MIME normalized
      const acq1 = client.getAcquisitionLinks(entry1);
      expect(acq1).toHaveLength(1);
      expect(acq1[0].type).toBe("application/epub+zip");

      // Entry 2: Parameterized MIME and legacy pjpeg
      const entry2 = feed.entries[1];
      const acq2 = client.getAcquisitionLinks(entry2);
      expect(acq2).toHaveLength(1);
      expect(acq2[0].type).toBe("application/epub+zip");

      const cover2 = client.getCoverLink(entry2);
      expect(cover2?.type).toBe("image/jpeg");
    });
  });

  describe("Readarr Server Compatibility", () => {
    it("successfully parses Readarr feed and promotes alternate links to acquisitions", async () => {
      const xml = loadFixture("readarr.xml");
      setupMockFetch(xml);

      const client = new OPDSClient();
      const feed = await client.fetchFeed("https://readarr.local/opds");

      expect(feed.serverProfile).toBe("readarr");
      expect(feed.entries).toHaveLength(2);

      // Entry 1: Alternate promoted to acquisition
      const entry1 = feed.entries[0];
      expect(entry1.title).toBe("Project Hail Mary");
      expect(entry1.authors[0].name).toBe("Andy Weir");
      expect(entry1.published).toBe("2021-05-04");
      expect(entry1["dcterms:publisher"]).toBe("Ballantine Books");

      const acq1 = client.getAcquisitionLinks(entry1);
      expect(acq1).toHaveLength(1);
      expect(acq1[0].rel).toBe("http://opds-spec.org/acquisition/open-access");
      expect(acq1[0].type).toBe("application/epub+zip");
      expect(client.getOpenAccessLink(entry1)?.href).toBe("https://readarr.local/opds/download/501.epub");

      // Entry 2: x-epub with alternate
      const entry2 = feed.entries[1];
      const acq2 = client.getAcquisitionLinks(entry2);
      expect(acq2).toHaveLength(1);
      expect(acq2[0].type).toBe("application/epub+zip");
    });
  });

  describe("Compatibility Toggle Control", () => {
    it("bypasses compatibility heuristics when enableCompatibility is false", async () => {
      const xml = loadFixture("readarr.xml");
      setupMockFetch(xml);

      // Initialize client with compatibility disabled
      const strictClient = new OPDSClient({ enableCompatibility: false });
      const feed = await strictClient.fetchFeed("https://readarr.local/opds");

      expect(feed.serverProfile).toBeUndefined();
      // Entry 1's link retains raw rel="alternate"
      const entry1 = feed.entries[0];
      expect(entry1.links[0].rel).toBe("alternate");
      // getAcquisitionLinks should find 0 links because alternate was not promoted
      expect(strictClient.getAcquisitionLinks(entry1)).toHaveLength(0);
    });
  });
});
