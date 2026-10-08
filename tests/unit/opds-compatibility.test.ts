import { describe, it, expect } from "vitest";
import {
  detectServerProfile,
  normalizeMimeType,
  normalizeLink,
  normalizeAuthors,
  normalizeDatesAndMetadata,
  normalizeFeed,
} from "../../src/services/opds/compatibility.ts";
import type { OPDSFeed, OPDSEntry, OPDSLink } from "../../src/domain/opds.ts";

describe("Milestone M15: OPDS Compatibility Normalization Layer", () => {
  describe("normalizeMimeType", () => {
    it("normalizes non-standard EPUB MIME types to application/epub+zip", () => {
      expect(normalizeMimeType("application/x-epub")).toBe("application/epub+zip");
      expect(normalizeMimeType("application/x-epub+zip")).toBe("application/epub+zip");
      expect(normalizeMimeType("application/epub")).toBe("application/epub+zip");
    });

    it("handles case-insensitivity and strips parameters from MIME types", () => {
      expect(normalizeMimeType("APPLICATION/EPUB+ZIP")).toBe("application/epub+zip");
      expect(normalizeMimeType("application/epub+zip; charset=utf-8")).toBe("application/epub+zip");
      expect(normalizeMimeType("APPLICATION/X-EPUB+ZIP; profile=opds")).toBe("application/epub+zip");
    });

    it("normalizes legacy image MIME types", () => {
      expect(normalizeMimeType("image/pjpeg")).toBe("image/jpeg");
      expect(normalizeMimeType("image/x-png")).toBe("image/png");
    });

    it("infers MIME type from file extension when generic octet-stream is supplied", () => {
      expect(normalizeMimeType("application/octet-stream", "https://example.com/books/123.epub")).toBe(
        "application/epub+zip",
      );
      expect(normalizeMimeType("binary/octet-stream", "https://example.com/covers/123.jpg")).toBe("image/jpeg");
      expect(normalizeMimeType(undefined, "https://example.com/images/cover.png?token=abc")).toBe("image/png");
    });
  });

  describe("normalizeLink", () => {
    it("converts shorthand acquisition rel to full OPDS acquisition URI", () => {
      const link: OPDSLink = {
        rel: "acquisition",
        href: "https://example.com/book.epub",
        type: "application/epub+zip",
      };
      const normalized = normalizeLink(link);
      expect(normalized.rel).toBe("http://opds-spec.org/acquisition");
    });

    it("converts shorthand and non-standard cover/thumbnail rels to standard URIs", () => {
      const coverLink: OPDSLink = {
        rel: "cover",
        href: "https://example.com/cover.jpg",
        type: "image/jpeg",
      };
      expect(normalizeLink(coverLink).rel).toBe("http://opds-spec.org/image");

      const legacyCover: OPDSLink = {
        rel: "http://opds-spec.org/cover",
        href: "https://example.com/cover.jpg",
      };
      expect(normalizeLink(legacyCover).rel).toBe("http://opds-spec.org/image");

      const thumbLink: OPDSLink = {
        rel: "thumbnail",
        href: "https://example.com/thumb.jpg",
      };
      expect(normalizeLink(thumbLink).rel).toBe("http://opds-spec.org/image/thumbnail");
    });

    it("promotes rel='alternate' pointing to an EPUB file to an open-access acquisition link", () => {
      const alternateEpub: OPDSLink = {
        rel: "alternate",
        href: "https://example.com/downloads/42.epub",
        type: "application/epub+zip",
      };
      const normalized = normalizeLink(alternateEpub);
      expect(normalized.rel).toBe("http://opds-spec.org/acquisition/open-access");
      expect(normalized.type).toBe("application/epub+zip");
    });

    it("preserves navigation rels like self, next, and search", () => {
      const nextLink: OPDSLink = {
        rel: "next",
        href: "https://example.com/opds?page=2",
      };
      expect(normalizeLink(nextLink).rel).toBe("next");
    });
  });

  describe("normalizeAuthors", () => {
    it("splits multi-author strings delimited by semicolons", () => {
      const authors = [{ name: "Neil Gaiman; Terry Pratchett" }];
      const normalized = normalizeAuthors(authors);
      expect(normalized).toHaveLength(2);
      expect(normalized[0].name).toBe("Neil Gaiman");
      expect(normalized[1].name).toBe("Terry Pratchett");
    });

    it("recovers authors from <dc:creator> elements when authors list is empty", () => {
      const xml = `<entry xmlns:dc="http://purl.org/dc/elements/1.1/">
        <id>urn:1</id>
        <title>Test Book</title>
        <dc:creator>Isaac Asimov</dc:creator>
      </entry>`;
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const entryEl = doc.documentElement;

      const normalized = normalizeAuthors([], entryEl);
      expect(normalized).toHaveLength(1);
      expect(normalized[0].name).toBe("Isaac Asimov");
    });

    it("recovers authors from unwrapped <author> tags without nested <name> tags", () => {
      const xml = `<entry>
        <id>urn:2</id>
        <title>Test Book 2</title>
        <author>Miya Kazuki</author>
      </entry>`;
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const entryEl = doc.documentElement;

      const normalized = normalizeAuthors([], entryEl);
      expect(normalized).toHaveLength(1);
      expect(normalized[0].name).toBe("Miya Kazuki");
    });
  });

  describe("normalizeDatesAndMetadata", () => {
    it("extracts publication date from <dc:date> when published is missing", () => {
      const xml = `<entry xmlns:dc="http://purl.org/dc/elements/1.1/">
        <id>urn:3</id>
        <title>Test Book 3</title>
        <dc:date>1984-06-08</dc:date>
        <dc:identifier>ISBN:1234567890</dc:identifier>
        <dc:publisher>Penguin</dc:publisher>
        <dc:description>Classic dystopian novel.</dc:description>
      </entry>`;
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const entryEl = doc.documentElement;

      const entry: OPDSEntry = {
        id: "urn:3",
        title: "Test Book 3",
        updated: "2026-10-08T00:00:00Z",
        authors: [],
        categories: [],
        links: [],
      };

      normalizeDatesAndMetadata(entry, entryEl);
      expect(entry.published).toBe("1984-06-08");
      expect(entry["dcterms:issued"]).toBe("1984-06-08");
      expect(entry["dcterms:identifier"]).toBe("ISBN:1234567890");
      expect(entry["dcterms:publisher"]).toBe("Penguin");
      expect(entry.summary).toBe("Classic dystopian novel.");
    });
  });

  describe("detectServerProfile", () => {
    it("detects Calibre-Web from generator tag or scheme", () => {
      const xml = `<feed><generator uri="https://github.com/janeczku/calibre-web">Calibre-Web</generator></feed>`;
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const feed: OPDSFeed = { id: "1", title: "C", updated: "", authors: [], links: [], entries: [] };
      expect(detectServerProfile(feed, doc)).toBe("calibre-web");
    });

    it("detects Komga from generator or path", () => {
      const xml = `<feed><generator>Komga</generator></feed>`;
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const feed: OPDSFeed = { id: "1", title: "K", updated: "", authors: [], links: [], entries: [] };
      expect(detectServerProfile(feed, doc)).toBe("komga");

      const feedWithPath: OPDSFeed = {
        id: "https://example.com/opds/v1.2/series",
        title: "K",
        updated: "",
        authors: [],
        links: [],
        entries: [],
      };
      expect(detectServerProfile(feedWithPath)).toBe("komga");
    });

    it("detects Kavita from generator or path", () => {
      const xml = `<feed><generator>Kavita</generator></feed>`;
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const feed: OPDSFeed = { id: "1", title: "K", updated: "", authors: [], links: [], entries: [] };
      expect(detectServerProfile(feed, doc)).toBe("kavita");
    });

    it("detects Readarr from generator tag", () => {
      const xml = `<feed><generator>Readarr</generator></feed>`;
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const feed: OPDSFeed = { id: "1", title: "R", updated: "", authors: [], links: [], entries: [] };
      expect(detectServerProfile(feed, doc)).toBe("readarr");
    });

    it("defaults to standard profile when no vendor indicators are present", () => {
      const xml = `<feed><title>Standard Catalog</title></feed>`;
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const feed: OPDSFeed = { id: "urn:std", title: "Std", updated: "", authors: [], links: [], entries: [] };
      expect(detectServerProfile(feed, doc)).toBe("standard");
    });
  });

  describe("normalizeFeed", () => {
    it("returns fully normalized feed with serverProfile attached", () => {
      const xml = `<feed xmlns:dc="http://purl.org/dc/elements/1.1/">
        <id>https://example.com/opds/v1.2/catalog</id>
        <title>Komga Library</title>
        <entry>
          <id>entry-1</id>
          <title>Book 1</title>
          <dc:creator>Test Creator</dc:creator>
          <link rel="alternate" href="https://example.com/book.epub" type="application/x-epub+zip" />
        </entry>
      </feed>`;
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const rawFeed: OPDSFeed = {
        id: "https://example.com/opds/v1.2/catalog",
        title: "Komga Library",
        updated: "2026-10-08T00:00:00Z",
        authors: [],
        links: [],
        entries: [
          {
            id: "entry-1",
            title: "Book 1",
            updated: "2026-10-08T00:00:00Z",
            authors: [],
            categories: [],
            links: [
              {
                rel: "alternate",
                href: "https://example.com/book.epub",
                type: "application/x-epub+zip",
              },
            ],
          },
        ],
      };

      const normalized = normalizeFeed(rawFeed, doc);
      expect(normalized.serverProfile).toBe("komga");
      expect(normalized.entries[0].authors).toHaveLength(1);
      expect(normalized.entries[0].authors[0].name).toBe("Test Creator");
      expect(normalized.entries[0].links[0].rel).toBe("http://opds-spec.org/acquisition/open-access");
      expect(normalized.entries[0].links[0].type).toBe("application/epub+zip");
    });
  });
});
