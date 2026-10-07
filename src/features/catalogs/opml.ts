/**
 * OPML (Outline Processor Markup Language) Import and Export
 *
 * Used for importing and exporting collections of OPDS catalogs
 * to and from other ebook readers (Aldiko, FBReader, Moon+ Reader, etc.).
 */

export interface OPMLOutline {
  name: string;
  url: string;
  description?: string;
}

/**
 * Escapes special XML characters in text.
 */
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Unescapes special XML character entities.
 */
function unescapeXml(safe: string): string {
  return safe
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Exports an array of catalog objects into a standard OPML 2.0 XML document string.
 */
export function exportCatalogsToOPML(
  catalogs: Array<{ name: string; url: string; description?: string | null }>,
  title = "educk OPDS Catalogs",
): string {
  const dateStr = new Date().toUTCString();
  const outlines = catalogs
    .map((cat) => {
      const name = escapeXml(cat.name || "Untitled Catalog");
      const url = escapeXml(cat.url);
      const descAttr = cat.description ? ` description="${escapeXml(cat.description)}"` : "";
      return `    <outline text="${name}" title="${name}" type="link" url="${url}"${descAttr}/>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${escapeXml(title)}</title>
    <dateCreated>${dateStr}</dateCreated>
    <docs>http://opml.org/spec2.opml</docs>
  </head>
  <body>
${outlines}
  </body>
</opml>`;
}

/**
 * Parses an OPML XML string and extracts OPDS catalog outline items.
 *
 * Supports both standard <outline type="link" url="...">,
 * RSS/Atom <outline type="rss" xmlUrl="...">, and generic outlines with url/xmlUrl attributes.
 */
export function parseOPML(opmlXml: string): OPMLOutline[] {
  if (!opmlXml || typeof opmlXml !== "string") {
    throw new Error("Invalid OPML: empty content");
  }

  // Use DOMParser if available (browser/happy-dom), fallback to regex
  if (typeof DOMParser !== "undefined") {
    const parser = new DOMParser();
    const doc = parser.parseFromString(opmlXml, "application/xml");

    // Check for parse errors
    const parserError = doc.querySelector("parsererror");
    if (parserError) {
      throw new Error(`OPML XML parse error: ${parserError.textContent?.slice(0, 100)}`);
    }

    const outlines = Array.from(doc.querySelectorAll("outline"));
    const results: OPMLOutline[] = [];

    for (const el of outlines) {
      const url = el.getAttribute("url") || el.getAttribute("xmlUrl") || el.getAttribute("htmlUrl");
      if (!url) continue;

      // Validate URL format (must be http/https)
      const trimmedUrl = url.trim();
      if (!/^https?:\/\//i.test(trimmedUrl)) continue;

      const name =
        el.getAttribute("title") ||
        el.getAttribute("text") ||
        el.getAttribute("name") ||
        "Unnamed Catalog";
      const description = el.getAttribute("description") || undefined;

      // Avoid duplicates in the same file
      if (!results.some((r) => r.url === trimmedUrl)) {
        results.push({
          name: name.trim(),
          url: trimmedUrl,
          description: description?.trim() || undefined,
        });
      }
    }

    return results;
  }

  // Regex-based fallback for non-DOM environments
  const results: OPMLOutline[] = [];
  const outlineRegex = /<outline\b([^>]+?)(?:\/>|>[\s\S]*?<\/outline>)/gi;
  let match: RegExpExecArray | null;

  while ((match = outlineRegex.exec(opmlXml)) !== null) {
    const attrs = match[1];
    const urlMatch = attrs.match(/\b(?:url|xmlUrl|htmlUrl)=["']([^"']+)["']/i);
    if (!urlMatch) continue;

    const rawUrl = unescapeXml(urlMatch[1]).trim();
    if (!/^https?:\/\//i.test(rawUrl)) continue;

    const titleMatch = attrs.match(/\b(?:title|text|name)=["']([^"']+)["']/i);
    const rawName = titleMatch ? unescapeXml(titleMatch[1]).trim() : "Unnamed Catalog";

    const descMatch = attrs.match(/\bdescription=["']([^"']+)["']/i);
    const rawDesc = descMatch ? unescapeXml(descMatch[1]).trim() : undefined;

    if (!results.some((r) => r.url === rawUrl)) {
      results.push({
        name: rawName,
        url: rawUrl,
        description: rawDesc || undefined,
      });
    }
  }

  return results;
}
