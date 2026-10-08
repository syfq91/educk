/**
 * OPDS 1.2 Ecosystem Compatibility Normalization Layer
 *
 * Implements heuristics to normalize real-world OPDS feed quirks from servers
 * such as Calibre-Web, Komga, Kavita, and Readarr without polluting the standard
 * RFC 4287 / OPDS 1.2 parser.
 */

import type {
  OPDSFeed,
  OPDSEntry,
  OPDSLink,
  OPDSPerson,
  OPDSLinkRel,
  OPDSLinkType,
  ServerProfile,
} from "../../domain/opds.ts";

/**
 * Traverses a subtree to find all elements matching any of the given localNames.
 * Avoids browser CSS selector parser limitations for colon-prefixed XML namespaces.
 */
function findElements(root: Element, localNames: string[]): Element[] {
  const elements: Element[] = [];
  const lowerNames = localNames.map((n) => n.toLowerCase());
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const el = node as Element;
    if (lowerNames.includes(el.localName.toLowerCase())) {
      elements.push(el);
    }
  }
  return elements;
}

/**
 * Traverses a subtree to find the first element matching any of the given localNames.
 */
function findFirstElement(root: Element, localNames: string[]): Element | undefined {
  const lowerNames = localNames.map((n) => n.toLowerCase());
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const el = node as Element;
    if (lowerNames.includes(el.localName.toLowerCase())) {
      return el;
    }
  }
  return undefined;
}

/**
 * Detects the originating server implementation based on XML generator metadata,
 * URI path conventions, or vendor-specific namespaces.
 */
export function detectServerProfile(feed: OPDSFeed, rawDoc?: Document): ServerProfile {
  if (rawDoc) {
    const generatorEl = rawDoc.querySelector("generator");
    if (generatorEl) {
      const genText = (generatorEl.textContent || "").toLowerCase();
      const genUri = (generatorEl.getAttribute("uri") || "").toLowerCase();
      if (genText.includes("calibre-web") || genUri.includes("calibre-web")) return "calibre-web";
      if (genText.includes("komga") || genUri.includes("komga")) return "komga";
      if (genText.includes("kavita") || genUri.includes("kavita")) return "kavita";
      if (genText.includes("readarr") || genUri.includes("readarr")) return "readarr";
    }

    // Check vendor namespaces or attributes (e.g. opf:scheme="calibre")
    if (rawDoc.documentElement) {
      const walker = document.createTreeWalker(rawDoc.documentElement, NodeFilter.SHOW_ELEMENT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const el = node as Element;
        for (let i = 0; i < el.attributes.length; i++) {
          const attr = el.attributes[i];
          if (attr.name.toLowerCase().includes("scheme") && attr.value.toLowerCase().includes("calibre")) {
            return "calibre-web";
          }
        }
      }
    }
  }

  // Fallback to feed ID and link URL heuristics
  const feedId = (feed.id || "").toLowerCase();
  const feedLinks = feed.links.map((l) => l.href.toLowerCase()).join(" ");

  if (feedId.includes("calibre-web") || feedLinks.includes("calibre-web")) return "calibre-web";
  if (feedId.includes("/opds/v1.2/") || feedLinks.includes("/opds/v1.2/") || feedId.includes("komga")) return "komga";
  if (feedId.includes("/api/opds/") || feedLinks.includes("/api/opds/") || feedId.includes("kavita")) return "kavita";
  if (feedId.includes("readarr") || feedLinks.includes("readarr")) return "readarr";

  return "standard";
}

/**
 * Normalizes non-standard, legacy, or parameter-polluted MIME types into
 * standard RFC-compliant MIME types.
 */
export function normalizeMimeType(type?: string, href?: string): string | undefined {
  if (!type && !href) return undefined;

  const cleanType = type ? type.split(";")[0].trim().toLowerCase() : "";

  // 1. Normalize non-standard EPUB types
  if (
    cleanType === "application/x-epub" ||
    cleanType === "application/x-epub+zip" ||
    cleanType === "application/epub"
  ) {
    return "application/epub+zip";
  }

  // 2. Normalize legacy image types
  if (cleanType === "image/pjpeg") return "image/jpeg";
  if (cleanType === "image/x-png") return "image/png";

  // 3. Fallback inference when type is generic or missing but file extension is indicative
  const hrefClean = (href || "").split("?")[0].toLowerCase();
  if (!cleanType || cleanType === "application/octet-stream" || cleanType === "binary/octet-stream") {
    if (hrefClean.endsWith(".epub")) return "application/epub+zip";
    if (hrefClean.endsWith(".jpg") || hrefClean.endsWith(".jpeg")) return "image/jpeg";
    if (hrefClean.endsWith(".png")) return "image/png";
    if (hrefClean.endsWith(".webp")) return "image/webp";
    if (hrefClean.endsWith(".pdf")) return "application/pdf";
  }

  return cleanType || undefined;
}

/**
 * Normalizes link relationship tokens and repairs non-standard acquisition links.
 */
export function normalizeLink(link: OPDSLink): OPDSLink {
  const normalized: OPDSLink = { ...link };

  // 1. Normalize shorthand and non-standard rel identifiers
  let rel = normalized.rel as string;
  if (rel === "acquisition") rel = "http://opds-spec.org/acquisition";
  else if (rel === "cover" || rel === "http://opds-spec.org/cover") rel = "http://opds-spec.org/image";
  else if (rel === "thumbnail" || rel === "http://opds-spec.org/thumbnail") rel = "http://opds-spec.org/image/thumbnail";
  normalized.rel = rel as OPDSLinkRel;

  // 2. Normalize MIME type
  normalized.type = normalizeMimeType(normalized.type, normalized.href) as OPDSLinkType | undefined;

  // 3. Alternate-as-Acquisition heuristic:
  // Many servers (e.g. Readarr / older Calibre) emit acquisition links as rel="alternate" pointing to .epub files
  const isEpubTarget =
    normalized.type === "application/epub+zip" ||
    normalized.href.split("?")[0].toLowerCase().endsWith(".epub");

  if (normalized.rel === "alternate" && isEpubTarget) {
    normalized.rel = "http://opds-spec.org/acquisition/open-access";
    normalized.type = "application/epub+zip";
  }

  // 4. If rel is acquisition but MIME type was missing, ensure EPUB type if URL matches
  if (normalized.rel.startsWith("http://opds-spec.org/acquisition") && !normalized.type && isEpubTarget) {
    normalized.type = "application/epub+zip";
  }

  // 5. Recursively normalize indirect acquisitions if present
  if (normalized["opds:indirectAcquisition"]) {
    normalized["opds:indirectAcquisition"] = normalized["opds:indirectAcquisition"].map(normalizeLink);
  }

  return normalized;
}

/**
 * Normalizes author lists, recovering from missing <name> child elements,
 * <dc:creator> tags, and delimited author lists.
 */
export function normalizeAuthors(authors: OPDSPerson[], entryEl?: Element): OPDSPerson[] {
  const result: OPDSPerson[] = [];

  const addAuthorString = (rawName: string) => {
    const trimmed = rawName.trim();
    if (!trimmed) return;

    // Semicolon indicates multiple authors: "Tolkien, J.R.R.; Lewis, C.S."
    if (trimmed.includes(";")) {
      const parts = trimmed.split(";").map((p) => p.trim()).filter(Boolean);
      for (const part of parts) {
        result.push({ name: part });
      }
      return;
    }

    result.push({ name: trimmed });
  };

  // 1. Process authors already parsed
  for (const author of authors) {
    if (author.name) {
      addAuthorString(author.name);
    }
  }

  // 2. If no authors found, search for <dc:creator> or direct text in <author> tags in entryEl
  if (result.length === 0 && entryEl) {
    // Check <dc:creator> using localName to bypass XML namespace prefix quirks
    const dcCreators = findElements(entryEl, ["creator"]);
    for (const creatorEl of dcCreators) {
      const text = creatorEl.textContent?.trim();
      if (text) {
        addAuthorString(text);
      }
    }

    // Check unwrapped <author> tags (e.g. <author>Jane Doe</author> without <name> child)
    if (result.length === 0) {
      const authorEls = Array.from(entryEl.querySelectorAll("author"));
      for (const aEl of authorEls) {
        if (!aEl.querySelector("name")) {
          const directText = aEl.textContent?.trim();
          if (directText) {
            addAuthorString(directText);
          }
        }
      }
    }
  }

  return result.length > 0 ? result : authors;
}

/**
 * Normalizes publication dates and Dublin Core metadata tags from vendor variations.
 */
export function normalizeDatesAndMetadata(entry: OPDSEntry, entryEl?: Element): void {
  if (!entryEl) return;

  // 1. Recover publication date from <dc:date> if published/issued is missing
  if (!entry.published && !entry["dcterms:issued"]) {
    const dateEl = findFirstElement(entryEl, ["date"]);
    const dateText = dateEl?.textContent?.trim();
    if (dateText) {
      entry.published = dateText;
      entry["dcterms:issued"] = dateText;
    }
  }

  // 2. Recover identifier from <dc:identifier> if dcterms:identifier is missing
  if (!entry["dcterms:identifier"]) {
    const idEl = findFirstElement(entryEl, ["identifier"]);
    const idText = idEl?.textContent?.trim();
    if (idText) {
      entry["dcterms:identifier"] = idText;
    }
  }

  // 3. Recover publisher from <dc:publisher>
  if (!entry["dcterms:publisher"]) {
    const pubEl = findFirstElement(entryEl, ["publisher"]);
    const pubText = pubEl?.textContent?.trim();
    if (pubText) {
      entry["dcterms:publisher"] = pubText;
    }
  }

  // 4. Recover summary from <dc:description>
  if (!entry.summary && !entry.content) {
    const descEl = findFirstElement(entryEl, ["description"]);
    const descText = descEl?.textContent?.trim();
    if (descText) {
      entry.summary = descText;
    }
  }
}

/**
 * Normalizes an individual OPDS entry with all compatibility heuristics.
 */
export function normalizeEntry(entry: OPDSEntry, entryEl?: Element): OPDSEntry {
  const links = entry.links.map(normalizeLink);
  const authors = normalizeAuthors(entry.authors, entryEl);

  const normalized: OPDSEntry = {
    ...entry,
    links,
    authors,
  };

  normalizeDatesAndMetadata(normalized, entryEl);

  return normalized;
}

/**
 * Normalizes an entire OPDS feed, detecting the server profile and applying
 * heuristics across feed metadata, links, facets, and entries.
 */
export function normalizeFeed(feed: OPDSFeed, rawDoc?: Document, _feedUrl?: string): OPDSFeed {
  const serverProfile = detectServerProfile(feed, rawDoc);

  // Normalize top-level feed links
  const links = feed.links.map(normalizeLink);

  // Normalize entries
  let entryElements: Element[] = [];
  if (rawDoc) {
    entryElements = Array.from(rawDoc.querySelectorAll("entry"));
  }

  const entries = feed.entries.map((entry, index) => {
    let matchedEl: Element | undefined;
    if (entryElements.length > 0) {
      matchedEl = entryElements.find((el) => {
        const idEl = el.querySelector("id");
        return idEl?.textContent?.trim() === entry.id;
      }) || entryElements[index];
    }
    return normalizeEntry(entry, matchedEl);
  });

  return {
    ...feed,
    serverProfile,
    links,
    entries,
  };
}
