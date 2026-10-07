import { describe, it, expect } from "vitest";
import { exportCatalogsToOPML, parseOPML } from "../../src/features/catalogs/opml.ts";

describe("Milestone M8: OPML Import and Export", () => {
  const sampleCatalogs = [
    {
      name: "Standard Ebooks",
      url: "https://standardebooks.org/opds",
      description: "Free public domain ebooks, beautifully formatted",
    },
    {
      name: "Project Gutenberg",
      url: "https://www.gutenberg.org/opds/catalog.rdf",
      description: "Over 60,000 free ebooks",
    },
    {
      name: "Feedbooks",
      url: "https://www.feedbooks.com/opds",
      description: null,
    },
  ];

  it("should export catalogs to valid OPML 2.0 XML", () => {
    const xml = exportCatalogsToOPML(sampleCatalogs, "My OPDS Feeds");

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<opml version="2.0">');
    expect(xml).toContain("<title>My OPDS Feeds</title>");
    expect(xml).toContain('text="Standard Ebooks"');
    expect(xml).toContain('url="https://standardebooks.org/opds"');
    expect(xml).toContain('description="Free public domain ebooks, beautifully formatted"');
    expect(xml).toContain('text="Project Gutenberg"');
    expect(xml).toContain('url="https://www.gutenberg.org/opds/catalog.rdf"');
    expect(xml).toContain('text="Feedbooks"');
  });

  it("should escape special characters in XML export", () => {
    const dangerousCatalogs = [
      {
        name: 'Books & "More" <Special>',
        url: "https://example.com/opds?a=1&b=2",
        description: "Contains <tags> and 'quotes' & ampersands",
      },
    ];

    const xml = exportCatalogsToOPML(dangerousCatalogs);

    expect(xml).toContain('text="Books &amp; &quot;More&quot; &lt;Special&gt;"');
    expect(xml).toContain('url="https://example.com/opds?a=1&amp;b=2"');
    expect(xml).toContain('description="Contains &lt;tags&gt; and &apos;quotes&apos; &amp; ampersands"');
  });

  it("should parse standard OPML XML with link outline types", () => {
    const opmlXml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Educk Catalogs</title>
  </head>
  <body>
    <outline text="Standard Ebooks" title="Standard Ebooks" type="link" url="https://standardebooks.org/opds" description="Curated free ebooks"/>
    <outline text="Gutenberg" title="Gutenberg" type="link" url="https://www.gutenberg.org/opds" />
  </body>
</opml>`;

    const parsed = parseOPML(opmlXml);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("Standard Ebooks");
    expect(parsed[0].url).toBe("https://standardebooks.org/opds");
    expect(parsed[0].description).toBe("Curated free ebooks");
    expect(parsed[1].name).toBe("Gutenberg");
    expect(parsed[1].url).toBe("https://www.gutenberg.org/opds");
    expect(parsed[1].description).toBeUndefined();
  });

  it("should parse RSS/Atom outline variants with xmlUrl", () => {
    const opmlXml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <head><title>Feeds</title></head>
  <body>
    <outline text="Feedbooks" type="rss" xmlUrl="https://www.feedbooks.com/opds" description="Feedbooks catalog"/>
  </body>
</opml>`;

    const parsed = parseOPML(opmlXml);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("Feedbooks");
    expect(parsed[0].url).toBe("https://www.feedbooks.com/opds");
    expect(parsed[0].description).toBe("Feedbooks catalog");
  });

  it("should filter out invalid URLs and non-http schemes", () => {
    const opmlXml = `<opml version="2.0"><body>
      <outline text="Bad 1" url="javascript:alert(1)" />
      <outline text="Bad 2" url="file:///etc/passwd" />
      <outline text="Bad 3" url="not-a-url" />
      <outline text="Good" url="https://valid.com/opds" />
    </body></opml>`;

    const parsed = parseOPML(opmlXml);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("Good");
    expect(parsed[0].url).toBe("https://valid.com/opds");
  });

  it("should deduplicate entries with identical URLs in the same OPML", () => {
    const opmlXml = `<opml version="2.0"><body>
      <outline text="First" url="https://example.com/opds" />
      <outline text="Second duplicate" url="https://example.com/opds" />
    </body></opml>`;

    const parsed = parseOPML(opmlXml);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("First");
  });

  it("should round-trip export and parse", () => {
    const xml = exportCatalogsToOPML(sampleCatalogs);
    const parsed = parseOPML(xml);

    expect(parsed).toHaveLength(sampleCatalogs.length);
    expect(parsed[0].name).toBe(sampleCatalogs[0].name);
    expect(parsed[0].url).toBe(sampleCatalogs[0].url);
    expect(parsed[0].description).toBe(sampleCatalogs[0].description);
    expect(parsed[1].name).toBe(sampleCatalogs[1].name);
    expect(parsed[1].url).toBe(sampleCatalogs[1].url);
    expect(parsed[2].name).toBe(sampleCatalogs[2].name);
    expect(parsed[2].url).toBe(sampleCatalogs[2].url);
  });

  it("should throw error on empty content", () => {
    expect(() => parseOPML("")).toThrow("empty content");
  });
});
