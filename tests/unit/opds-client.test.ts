import { describe, it, expect, vi, beforeEach } from "vitest";
import { OPDSClient } from "../../src/services/opds/opds-client.ts";
import type { OPDSFeed, OPDSEntry, OPDSLink as _OPDSLink } from "../../src/domain/opds.ts";

// Mock fetch globally for this test file
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("Milestone M7: OPDSClient", () => {
  let client: OPDSClient;

  beforeEach(() => {
    client = new OPDSClient();
    mockFetch.mockReset();
  });

  const createMockFeed = (overrides: Partial<OPDSFeed> = {}): OPDSFeed => ({
    id: "https://example.com/opds",
    title: "Test Catalog",
    updated: new Date().toISOString(),
    authors: [{ name: "Test Author" }],
    links: [
      { rel: "self", href: "https://example.com/opds", type: "application/atom+xml;profile=opds-catalog" },
      { rel: "next", href: "https://example.com/opds?page=2" },
    ],
    entries: [],
    ...overrides,
  });

  const createMockEntry = (overrides: Partial<OPDSEntry> = {}): OPDSEntry => ({
    id: "book-1",
    title: "Test Book",
    updated: new Date().toISOString(),
    authors: [{ name: "Author Name" }],
    categories: [],
    links: [
      { rel: "http://opds-spec.org/acquisition/open-access", href: "https://example.com/book.epub", type: "application/epub+zip" },
      { rel: "http://opds-spec.org/image", href: "https://example.com/cover.jpg", type: "image/jpeg" },
    ],
    ...overrides,
  });

  it("should fetch and parse a valid OPDS feed", async () => {
    const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>https://example.com/opds</id>
  <title>Test Catalog</title>
  <updated>2024-01-01T00:00:00Z</updated>
  <author><name>Test Author</name></author>
  <link rel="self" href="https://example.com/opds" type="application/atom+xml;profile=opds-catalog"/>
  <link rel="next" href="https://example.com/opds?page=2"/>
</feed>`;

    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/atom+xml" }),
      text: () => Promise.resolve(feedXml),
    });

    const feed = await client.fetchFeed("https://example.com/opds");

    expect(feed.id).toBe("https://example.com/opds");
    expect(feed.title).toBe("Test Catalog");
    expect(feed.authors).toHaveLength(1);
    expect(feed.links).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/opds",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: expect.stringContaining("application/atom+xml"),
          "User-Agent": "educk/0.1.0 (Android; OPDS 1.2 Client)",
        }),
      }),
    );
  });

  it("should parse entries with acquisition links", async () => {
    const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog" xmlns:dc="http://purl.org/dc/terms/">
  <id>https://example.com/opds</id>
  <title>Test Catalog</title>
  <updated>2024-01-01T00:00:00Z</updated>
  <author><name>Test Author</name></author>
  <entry>
    <id>book-1</id>
    <title>Test Book</title>
    <updated>2024-01-01T00:00:00Z</updated>
    <author><name>Author Name</name></author>
    <dc:publisher>Test Publisher</dc:publisher>
    <dc:language>en</dc:language>
    <link rel="http://opds-spec.org/acquisition/open-access" href="https://example.com/book.epub" type="application/epub+zip" length="100000"/>
    <link rel="http://opds-spec.org/image" href="https://example.com/cover.jpg" type="image/jpeg"/>
  </entry>
</feed>`;

    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/atom+xml" }),
      text: () => Promise.resolve(feedXml),
    });

    const feed = await client.fetchFeed("https://example.com/opds");

    expect(feed.entries).toHaveLength(1);
    const entry = feed.entries[0];
    expect(entry.id).toBe("book-1");
    expect(entry.title).toBe("Test Book");
    expect(entry.authors[0].name).toBe("Author Name");
    expect(entry["dcterms:publisher"]).toBe("Test Publisher");
    expect(entry["dcterms:language"]).toBe("en");

    const openAccessLink = client.getOpenAccessLink(entry);
    expect(openAccessLink).not.toBeNull();
    expect(openAccessLink?.href).toBe("https://example.com/book.epub");
    expect(openAccessLink?.length).toBe(100000);
  });

  it("should parse entries with multiple acquisition options", async () => {
    const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>https://example.com/opds</id>
  <title>Test Catalog</title>
  <updated>2024-01-01T00:00:00Z</updated>
  <author><name>Test Author</name></author>
  <entry>
    <id>book-1</id>
    <title>Test Book</title>
    <updated>2024-01-01T00:00:00Z</updated>
    <author><name>Author Name</name></author>
    <link rel="http://opds-spec.org/acquisition" href="https://example.com/book.epub" type="application/epub+zip" length="100000"/>
    <link rel="http://opds-spec.org/acquisition/borrow" href="https://example.com/borrow" type="application/epub+zip"/>
  </entry>
</feed>`;

    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/atom+xml" }),
      text: () => Promise.resolve(feedXml),
    });

    const feed = await client.fetchFeed("https://example.com/opds");
    const entry = feed.entries[0];

    const acquisitionLinks = client.getAcquisitionLinks(entry);
    expect(acquisitionLinks).toHaveLength(2);
    expect(acquisitionLinks[0].rel).toBe("http://opds-spec.org/acquisition");
    expect(acquisitionLinks[1].rel).toBe("http://opds-spec.org/acquisition/borrow");
  });

  it("should handle authentication (Basic Auth)", async () => {
    const authClient = new OPDSClient();

    const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>https://example.com/opds</id>
  <title>Private Catalog</title>
  <updated>2024-01-01T00:00:00Z</updated>
  <author><name>Test</name></author>
</feed>`;

    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/atom+xml" }),
      text: () => Promise.resolve(feedXml),
    });

    await authClient.fetchFeed("https://example.com/opds", {
      auth: { type: "basic", username: "user", password: "pass" },
    });

    const authHeader = mockFetch.mock.calls[0][1]?.headers?.["Authorization"];
    expect(authHeader).toBe("Basic dXNlcjpwYXNz"); // base64("user:pass")
  });

  it("should handle authentication (Bearer Token)", async () => {
    const authClient = new OPDSClient();

    const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>https://example.com/opds</id>
  <title>Private Catalog</title>
  <updated>2024-01-01T00:00:00Z</updated>
  <author><name>Test</name></author>
</feed>`;

    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/atom+xml" }),
      text: () => Promise.resolve(feedXml),
    });

    await authClient.fetchFeed("https://example.com/opds", {
      auth: { type: "bearer", token: "secret-token" },
    });

    const authHeader = mockFetch.mock.calls[0][1]?.headers?.["Authorization"];
    expect(authHeader).toBe("Bearer secret-token");
  });

  it("should throw OPDSAuthError on 401", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    await expect(client.fetchFeed("https://example.com/opds")).rejects.toThrow("Authentication required");
  });

  it("should throw OPDSNetworkError on network failure", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    await expect(client.fetchFeed("https://example.com/opds")).rejects.toThrow("Network error");
  });

  it("should retry on transient failures", async () => {
    const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>https://example.com/opds</id>
  <title>Test Catalog</title>
  <updated>2024-01-01T00:00:00Z</updated>
  <author><name>Test</name></author>
</feed>`;

    mockFetch
      .mockRejectedValueOnce(new Error("Transient error"))
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/atom+xml" }),
        text: () => Promise.resolve(feedXml),
      });

    const retryClient = new OPDSClient({ maxRetries: 2, retryDelay: 1 });
    const feed = await retryClient.fetchFeed("https://example.com/opds");

    expect(feed.title).toBe("Test Catalog");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should get cover and thumbnail links", async () => {
    const entry = createMockEntry();

    const coverLink = client.getCoverLink(entry);
    expect(coverLink?.href).toBe("https://example.com/cover.jpg");

    const thumbnailLink = client.getThumbnailLink(entry);
    expect(thumbnailLink?.href).toBe("https://example.com/cover.jpg"); // Same as cover when no separate thumbnail
  });

  it("should get navigation links from feed", async () => {
    const feed = createMockFeed({
      links: [
        { rel: "self", href: "https://example.com/opds" },
        { rel: "subsection", href: "https://example.com/opds/fiction" },
        { rel: "next", href: "https://example.com/opds?page=2" },
        { rel: "http://opds-spec.org/sort/popular", href: "https://example.com/opds?sort=popular" },
      ],
    });

    const navLinks = client.getNavigationLinks(feed);
    expect(navLinks).toHaveLength(3); // subsection, next, sort/popular
    expect(navLinks.map((l) => l.rel)).toEqual(["subsection", "next", "http://opds-spec.org/sort/popular"]);
  });

  it("should get next page link", async () => {
    const feed = createMockFeed({
      links: [
        { rel: "next", href: "https://example.com/opds?page=2" },
      ],
    });

    const nextLink = client.getNextPageLink(feed);
    expect(nextLink?.href).toBe("https://example.com/opds?page=2");
  });

  it("should parse facets", async () => {
    const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>https://example.com/opds</id>
  <title>Test Catalog</title>
  <updated>2024-01-01T00:00:00Z</updated>
  <author><name>Test</name></author>
  <opds:facetGroup name="Genre">
    <opds:facet value="fiction" count="100" label="Fiction"/>
    <opds:facet value="nonfiction" count="50" label="Non-Fiction"/>
  </opds:facetGroup>
</feed>`;

    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/atom+xml" }),
      text: () => Promise.resolve(feedXml),
    });

    const feed = await client.fetchFeed("https://example.com/opds");
    expect(feed.facets).toHaveLength(1);
    expect(feed.facets[0].name).toBe("Genre");
    expect(feed.facets[0].values).toHaveLength(2);
    expect(feed.facets[0].values[0].value).toBe("fiction");
    expect(feed.facets[0].values[0].count).toBe(100);
  });

  it("should parse search link", async () => {
    const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <id>https://example.com/opds</id>
  <title>Test Catalog</title>
  <updated>2024-01-01T00:00:00Z</updated>
  <author><name>Test</name></author>
  <link rel="search" href="https://example.com/opds/search" type="application/opensearchdescription+xml"/>
</feed>`;

    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/atom+xml" }),
      text: () => Promise.resolve(feedXml),
    });

    const feed = await client.fetchFeed("https://example.com/opds");
    expect(feed.searchLink).not.toBeNull();
    expect(feed.searchLink?.href).toBe("https://example.com/opds/search");
  });

  it("should handle pagination metadata", async () => {
    const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <id>https://example.com/opds</id>
  <title>Test Catalog</title>
  <updated>2024-01-01T00:00:00Z</updated>
  <author><name>Test</name></author>
  <opensearch:totalResults>1000</opensearch:totalResults>
  <opensearch:itemsPerPage>20</opensearch:itemsPerPage>
  <opensearch:startIndex>1</opensearch:startIndex>
</feed>`;

    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/atom+xml" }),
      text: () => Promise.resolve(feedXml),
    });

    const feed = await client.fetchFeed("https://example.com/opds");
    expect(feed.totalResults).toBe(1000);
    expect(feed.itemsPerPage).toBe(20);
    expect(feed.startIndex).toBe(1);
  });
});