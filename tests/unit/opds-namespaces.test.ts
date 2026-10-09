import { describe, it, expect, vi, afterEach } from "vitest";
import { OPDSClient } from "../../src/services/opds/opds-client.ts";
import type { OPDSEntry } from "../../src/domain/opds.ts";

/**
 * Milestone M18 regression coverage for namespace-qualified OPDS elements.
 *
 * `OPDSClient.getTextContent` / `parseIntValue` used to call `querySelector` with names like
 * `opds:price` and `opensearch:totalResults`. Chromium (and therefore the Android WebView)
 * throws `SyntaxError` for those selectors, which aborted the entire feed parse. The
 * unit-test DOM (happy-dom) only returns `null`, so the crash was invisible to Vitest and
 * only showed up when browsing a real catalog on a device.
 */

const NAMESPACE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opds="http://opds-spec.org/2010/catalog"
      xmlns:dcterms="http://purl.org/dc/terms/"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <id>urn:test:catalog</id>
  <title>Namespaced Catalog</title>
  <updated>2026-01-01T00:00:00Z</updated>
  <opensearch:totalResults>42</opensearch:totalResults>
  <opensearch:itemsPerPage>10</opensearch:itemsPerPage>
  <opensearch:startIndex>1</opensearch:startIndex>
  <entry>
    <id>urn:test:book:1</id>
    <title>Namespaced Book</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <dcterms:identifier>urn:isbn:9780000000000</dcterms:identifier>
    <dcterms:issued>2020-05-04</dcterms:issued>
    <dcterms:publisher>Test Press</dcterms:publisher>
    <opds:price>0.99</opds:price>
    <opds:availability>available</opds:availability>
    <link rel="http://opds-spec.org/acquisition"
          href="https://example.com/book.epub"
          type="application/epub+zip"
          opds:price="0.99"/>
  </entry>
</feed>`;

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function stubFeed(body: string): void {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "content-type": "application/atom+xml" }),
    text: async () => body,
  });
}

describe("Milestone M18: namespace-qualified OPDS parsing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
  });

  it("reads opds:/dcterms:/opensearch: elements instead of aborting the feed", async () => {
    stubFeed(NAMESPACE_FEED);

    const feed = await new OPDSClient({
      enableCompatibility: false,
    }).fetchFeed("https://example.com/opds");

    expect(feed.title).toBe("Namespaced Catalog");
    expect(feed.totalResults).toBe(42);
    expect(feed.itemsPerPage).toBe(10);
    expect(feed.startIndex).toBe(1);

    expect(feed.entries).toHaveLength(1);
    const entry = feed.entries[0] as OPDSEntry;
    expect(entry.title).toBe("Namespaced Book");
    expect(entry["opds:price"]).toBe("0.99");
    expect(entry["opds:availability"]).toBe("available");
    expect(entry["dcterms:identifier"]).toBe("urn:isbn:9780000000000");
    expect(entry["dcterms:issued"]).toBe("2020-05-04");
    expect(entry["dcterms:publisher"]).toBe("Test Press");

    const acquisition = entry.links.find(
      (link) => link.rel === "http://opds-spec.org/acquisition",
    );
    expect(acquisition?.["opds:price"]).toBe("0.99");
  });

  it("parses the same feed through the compatibility normalizer", async () => {
    stubFeed(NAMESPACE_FEED);

    const feed = await new OPDSClient().fetchFeed("https://example.com/opds");

    expect(feed.entries).toHaveLength(1);
    expect(feed.entries[0].title).toBe("Namespaced Book");
    expect(feed.entries[0]["opds:price"]).toBe("0.99");
    expect(feed.totalResults).toBe(42);
  });

  it("never hands a qualified name to querySelector, as Chromium would throw", async () => {
    // Emulate the WebView/Chromium contract: `querySelector("opds:price")` throws
    // `SyntaxError`. happy-dom returns null, which is exactly how this bug survived CI.
    const probe = new DOMParser().parseFromString("<root/>", "application/xml");
    let proto: object | null = Object.getPrototypeOf(probe.documentElement);
    while (proto && !Object.prototype.hasOwnProperty.call(proto, "querySelector")) {
      proto = Object.getPrototypeOf(proto);
    }
    expect(proto, "querySelector prototype not found").toBeTruthy();

    const original = (proto as { querySelector: (selector: string) => Element | null })
      .querySelector;
    const rejected: string[] = [];
    vi.spyOn(proto as object, "querySelector").mockImplementation(function (
      this: Element,
      selector: string,
    ) {
      if (/^[A-Za-z_][A-Za-z0-9_-]*:/.test(selector)) {
        rejected.push(selector);
        throw new SyntaxError(
          `Failed to execute 'querySelector' on 'Element': '${selector}' is not a valid selector.`,
        );
      }
      return original.call(this, selector);
    });

    stubFeed(NAMESPACE_FEED);

    const feed = await new OPDSClient().fetchFeed("https://example.com/opds");

    expect(rejected).toEqual([]);
    expect(feed.entries).toHaveLength(1);
    expect(feed.entries[0]["opds:price"]).toBe("0.99");
    expect(feed.totalResults).toBe(42);
  });
});
