/**
 * OPDS 1.2 Client
 *
 * Parses OPDS 1.2 feeds (Atom XML with OPDS extensions) and provides
 * a typed interface for navigating catalogs and acquiring books.
 */

import {
  OPDSFeed,
  OPDSEntry,
  OPDSLink,
  OPDSPerson,
  OPDSCategory,
  OPDSFacet,
  OPDSFacetValue,
  OPDSCatalogAuth,
  OPDSClientConfig,
  OPDSFetchOptions,
  OPDSParseError,
  OPDSNetworkError,
  OPDSAuthError,
  OPDSLinkRel,
  OPDSLinkType,
  AcquisitionLink,
} from "../../domain/opds.ts";

const DEFAULT_CONFIG: OPDSClientConfig = {
  timeout: 15000,
  userAgent: "educk/0.1.0 (Android; OPDS 1.2 Client)",
  maxRetries: 3,
  retryDelay: 1000,
};

export class OPDSClient {
  private config: OPDSClientConfig;

  constructor(config: Partial<OPDSClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async fetchFeed(url: string, options: OPDSFetchOptions = {}): Promise<OPDSFeed> {
    const headers = this.buildHeaders(options.auth);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        if (options.signal) {
          options.signal.addEventListener("abort", () => controller.abort());
        }

        const response = await fetch(url, {
          method: "GET",
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new OPDSAuthError(`Authentication required (${response.status})`, url);
          }
          throw new OPDSNetworkError(
            `HTTP ${response.status}: ${response.statusText}`,
            new Error(`HTTP ${response.status}`),
            url,
          );
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("xml") && !contentType.includes("atom")) {
          console.warn(`Unexpected content type for OPDS feed: ${contentType}`);
        }

        const xmlText = await response.text();
        return this.parseFeed(xmlText, url);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Don't retry on auth errors or abort
        if (err instanceof OPDSAuthError || err instanceof DOMException) {
          throw err;
        }

        if (attempt < this.config.maxRetries) {
          await this.sleep(this.config.retryDelay * Math.pow(2, attempt));
        }
      }
    }

    throw new OPDSNetworkError(
      `Failed after ${this.config.maxRetries + 1} attempts: ${lastError?.message}`,
      lastError!,
      url,
    );
  }

  private buildHeaders(auth?: OPDSCatalogAuth): HeadersInit {
    const headers: HeadersInit = {
      Accept: "application/atom+xml;profile=opds-catalog, application/atom+xml;q=0.9, */*;q=0.8",
      "User-Agent": this.config.userAgent,
    };

    if (auth) {
      switch (auth.type) {
        case "basic":
          if (auth.username && auth.password) {
            const credentials = btoa(`${auth.username}:${auth.password}`);
            headers["Authorization"] = `Basic ${credentials}`;
          }
          break;
        case "bearer":
          if (auth.token) {
            headers["Authorization"] = `Bearer ${auth.token}`;
          }
          break;
      }
    }

    return headers;
  }

  private parseFeed(xmlText: string, feedUrl: string): OPDSFeed {
    let doc: Document;

    try {
      const parser = new DOMParser();
      doc = parser.parseFromString(xmlText, "application/xml");
    } catch (err) {
      throw new OPDSParseError(`Failed to parse XML: ${err instanceof Error ? err.message : String(err)}`, xmlText);
    }

    // Check for parser errors
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      throw new OPDSParseError(`XML parse error: ${parseError.textContent}`, xmlText);
    }

    const feed = doc.documentElement;
    if (!feed || feed.tagName.toLowerCase() !== "feed") {
      throw new OPDSParseError("Root element is not <feed>", xmlText);
    }

    return {
      id: this.getTextContent(feed, "id") || feedUrl,
      title: this.getTextContent(feed, "title") || "Untitled Catalog",
      updated: this.getTextContent(feed, "updated") || new Date().toISOString(),
      authors: this.parseAuthors(feed),
      links: this.parseLinks(feed),
      entries: this.parseEntries(feed),
      totalResults: this.parseIntValue(feed, "opensearch:totalResults"),
      itemsPerPage: this.parseIntValue(feed, "opensearch:itemsPerPage"),
      startIndex: this.parseIntValue(feed, "opensearch:startIndex"),
      searchLink: this.findLink(feed, "search"),
      facets: this.parseFacets(feed),
    };
  }

  private parseAuthors(element: Element): OPDSPerson[] {
    const authors: OPDSPerson[] = [];
    const authorElements = element.querySelectorAll("author");

    authorElements.forEach((authorEl) => {
      const name = this.getTextContent(authorEl, "name");
      const uri = this.getTextContent(authorEl, "uri");
      const email = this.getTextContent(authorEl, "email");

      if (name) {
        authors.push({ name, uri: uri || undefined, email: email || undefined });
      }
    });

    return authors;
  }

  private parseLinks(element: Element): OPDSLink[] {
    const links: OPDSLink[] = [];
    const linkElements = element.querySelectorAll("link");

    linkElements.forEach((linkEl) => {
      const href = linkEl.getAttribute("href");
      if (!href) return;

      const rel = (linkEl.getAttribute("rel") || "alternate") as OPDSLinkRel;
      const type = linkEl.getAttribute("type") as OPDSLinkType | undefined;
      const title = linkEl.getAttribute("title") || undefined;
      const lengthStr = linkEl.getAttribute("length");
      const length = lengthStr ? parseInt(lengthStr, 10) : undefined;

      const link: OPDSLink = { rel, href: this.resolveUrl(href, element.baseURI), type, title, length };

      // OPDS extensions
      const price = linkEl.getAttribute("opds:price");
      if (price) link["opds:price"] = price;

      const availability = linkEl.getAttribute("opds:availability");
      if (availability) link["opds:availability"] = availability;

      const commission = linkEl.getAttribute("opds:commission");
      if (commission) link["opds:commission"] = commission;

      // Indirect acquisition
      const indirectLinks = linkEl.querySelectorAll("link[rel^='http://opds-spec.org/acquisition']");
      if (indirectLinks.length > 0) {
        link["opds:indirectAcquisition"] = Array.from(indirectLinks).map((il) => {
          const ihref = il.getAttribute("href");
          const irel = (il.getAttribute("rel") || "") as OPDSLinkRel;
          const itype = il.getAttribute("type") as OPDSLinkType | undefined;
          const ititle = il.getAttribute("title") || undefined;
          const ilengthStr = il.getAttribute("length");
          const ilength = ilengthStr ? parseInt(ilengthStr, 10) : undefined;
          return { rel: irel, href: this.resolveUrl(ihref || "", element.baseURI), type: itype, title: ititle, length: ilength };
        });
      }

      links.push(link);
    });

    return links;
  }

  private parseEntries(element: Element): OPDSEntry[] {
    const entries: OPDSEntry[] = [];
    const entryElements = element.querySelectorAll("entry");

    entryElements.forEach((entryEl) => {
      const entry = this.parseEntry(entryEl);
      if (entry) entries.push(entry);
    });

    return entries;
  }

  private parseEntry(entryEl: Element): OPDSEntry | null {
    const id = this.getTextContent(entryEl, "id");
    if (!id) return null;

    const title = this.getTextContent(entryEl, "title") || "Untitled";
    const updated = this.getTextContent(entryEl, "updated") || new Date().toISOString();
    const published = this.getTextContent(entryEl, "published") || undefined;

    const authors = this.parseAuthors(entryEl);
    const contributors = this.parseContributors(entryEl);

    const summary = this.getTextContent(entryEl, "summary") || undefined;
    const content = this.getTextContent(entryEl, "content") || undefined;

    const categories = this.parseCategories(entryEl);
    const links = this.parseLinks(entryEl);

    const rights = this.getTextContent(entryEl, "rights") || undefined;

    // OPDS-specific metadata
    const price = this.getTextContent(entryEl, "opds:price") || undefined;
    const availability = this.getTextContent(entryEl, "opds:availability") || undefined;
    const identifier = this.getTextContent(entryEl, "dcterms:identifier") || undefined;
    const issued = this.getTextContent(entryEl, "dcterms:issued") || undefined;
    const language = this.getTextContent(entryEl, "dcterms:language") || undefined;
    const publisher = this.getTextContent(entryEl, "dcterms:publisher") || undefined;
    const rightsDc = this.getTextContent(entryEl, "dcterms:rights") || undefined;
    const subject = this.getTextContent(entryEl, "dcterms:subject") || undefined;

    return {
      id,
      title,
      updated,
      published,
      authors,
      contributors: contributors.length > 0 ? contributors : undefined,
      summary,
      content,
      categories,
      links,
      rights,
      "opds:price": price,
      "opds:availability": availability,
      "dcterms:identifier": identifier,
      "dcterms:issued": issued,
      "dcterms:language": language,
      "dcterms:publisher": publisher,
      "dcterms:rights": rightsDc,
      "dcterms:subject": subject,
    };
  }

  private parseContributors(element: Element): OPDSPerson[] {
    const contributors: OPDSPerson[] = [];
    const contribElements = element.querySelectorAll("contributor");

    contribElements.forEach((contribEl) => {
      const name = this.getTextContent(contribEl, "name");
      const uri = this.getTextContent(contribEl, "uri");
      const email = this.getTextContent(contribEl, "email");

      if (name) {
        contributors.push({ name, uri: uri || undefined, email: email || undefined });
      }
    });

    return contributors;
  }

  private parseCategories(element: Element): OPDSCategory[] {
    const categories: OPDSCategory[] = [];
    const catElements = element.querySelectorAll("category");

    catElements.forEach((catEl) => {
      const term = catEl.getAttribute("term");
      if (!term) return;

      const scheme = catEl.getAttribute("scheme") || undefined;
      const label = catEl.getAttribute("label") || undefined;

      categories.push({ scheme, term, label });
    });

    return categories;
  }

  private parseFacets(element: Element): OPDSFacet[] {
    const facets: OPDSFacet[] = [];

    // 1. Use TreeWalker to find facetGroup elements with opds namespace
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const el = node as Element;
      if (el.localName === "facetGroup" && (el.namespaceURI === "http://opds-spec.org/2010/catalog" || el.prefix === "opds")) {
        const name = el.getAttribute("name") || el.getAttribute("term") || "Unknown";
        const values: OPDSFacetValue[] = [];

        // Find facet children
        const valueWalker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
        let valueNode: Node | null;
        while ((valueNode = valueWalker.nextNode())) {
          const valueEl = valueNode as Element;
          if (valueEl.localName === "facet" && (valueEl.namespaceURI === "http://opds-spec.org/2010/catalog" || valueEl.prefix === "opds")) {
            const value = valueEl.getAttribute("value") || valueEl.getAttribute("term") || "";
            const countStr = valueEl.getAttribute("count");
            const count = countStr ? parseInt(countStr, 10) : 0;
            const label = valueEl.getAttribute("label") || value;
            const rawHref = valueEl.getAttribute("href");
            const href = rawHref ? this.resolveUrl(rawHref, element.baseURI) : undefined;
            const active = valueEl.getAttribute("active") === "true";

            if (value) {
              values.push({ value, count, label, href, active });
            }
          }
        }

        if (values.length > 0) {
          facets.push({ name, values });
        }
      }
    }

    // 2. Also check standard OPDS 1.2 link elements with rel="http://opds-spec.org/facet"
    const linkWalker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
    while ((node = linkWalker.nextNode())) {
      const el = node as Element;
      if (el.localName === "link" && el.getAttribute("rel") === "http://opds-spec.org/facet") {
        const groupName = el.getAttribute("opds:facetGroup") || el.getAttribute("facetGroup") || "Filter";
        const title = el.getAttribute("title") || "Option";
        const hrefRaw = el.getAttribute("href");
        const href = hrefRaw ? this.resolveUrl(hrefRaw, element.baseURI) : undefined;
        const countStr = el.getAttribute("opds:count") || el.getAttribute("count");
        const count = countStr ? parseInt(countStr, 10) : 0;
        const active = el.getAttribute("opds:activeFacet") === "true" || el.getAttribute("activeFacet") === "true";

        let existingGroup = facets.find((f) => f.name.toLowerCase() === groupName.toLowerCase());
        if (!existingGroup) {
          existingGroup = { name: groupName, values: [] };
          facets.push(existingGroup);
        }

        existingGroup.values.push({
          value: title,
          label: title,
          count,
          href,
          active,
        });
      }
    }

    return facets;
  }

  private findLink(element: Element, rel: string): OPDSLink | undefined {
    const linkEl = element.querySelector(`link[rel="${rel}"]`);
    if (!linkEl) return undefined;

    const href = linkEl.getAttribute("href");
    if (!href) return undefined;

    return {
      rel: rel as OPDSLinkRel,
      href: this.resolveUrl(href, element.baseURI),
      type: linkEl.getAttribute("type") as OPDSLinkType | undefined,
      title: linkEl.getAttribute("title") || undefined,
    };
  }

  private parseIntValue(element: Element, tagName: string): number | undefined {
    // Try direct querySelector first
    const el = element.querySelector(tagName);
    if (el) {
      const value = parseInt(el.textContent || "", 10);
      return isNaN(value) ? undefined : value;
    }
    
    // Try with namespace for opensearch elements
    if (tagName.startsWith("opensearch:")) {
      const localName = tagName.replace("opensearch:", "");
      const elements = element.getElementsByTagNameNS("http://a9.com/-/spec/opensearch/1.1/", localName);
      if (elements.length > 0) {
        const value = parseInt(elements[0].textContent || "", 10);
        return isNaN(value) ? undefined : value;
      }
    }
    
    // Fallback: use TreeWalker to find opensearch elements
    if (tagName.startsWith("opensearch:")) {
      const localName = tagName.replace("opensearch:", "");
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const walkerEl = node as Element;
        if (walkerEl.localName === localName && walkerEl.namespaceURI === "http://a9.com/-/spec/opensearch/1.1/") {
          const value = parseInt(walkerEl.textContent || "", 10);
          return isNaN(value) ? undefined : value;
        }
      }
    }
    
    return undefined;
  }

  private getTextContent(element: Element, tagName: string): string | null {
    // Handle namespaced elements (e.g., dc:publisher, dcterms:publisher)
    const el = element.querySelector(tagName);
    if (el) return el.textContent?.trim() || null;
    
    // Try with namespace - check for dc: prefix (Dublin Core)
    // The test uses dc:publisher but the code expects dcterms:publisher
    if (tagName.startsWith("dcterms:")) {
      const localName = tagName.replace("dcterms:", "");
      
      // Try getElementsByTagNameNS first (most reliable for namespaces)
      const dcElements = element.getElementsByTagNameNS("http://purl.org/dc/terms/", localName);
      if (dcElements.length > 0) {
        return dcElements[0].textContent?.trim() || null;
      }
      
      // Fallback: iterate all descendants and check namespaceURI and localName
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const walkerEl = node as Element;
        if (walkerEl.namespaceURI === "http://purl.org/dc/terms/" && walkerEl.localName === localName) {
          return walkerEl.textContent?.trim() || null;
        }
      }
    }
    
    return null;
  }

  private resolveUrl(href: string, baseUrl: string): string {
    try {
      return new URL(href, baseUrl).href;
    } catch {
      return href;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --- Convenience methods ---

  getAcquisitionLinks(entry: OPDSEntry): AcquisitionLink[] {
    return entry.links
      .filter((link) => link.rel.startsWith("http://opds-spec.org/acquisition"))
      .map((link) => link as AcquisitionLink);
  }

  getOpenAccessLink(entry: OPDSEntry): AcquisitionLink | null {
    const links = this.getAcquisitionLinks(entry);
    return links.find((l) => l.rel === "http://opds-spec.org/acquisition/open-access" as OPDSLinkRel) || null;
  }

  getCoverLink(entry: OPDSEntry): OPDSLink | null {
    return entry.links.find((l) => l.rel === "http://opds-spec.org/image" || l.rel === "http://opds-spec.org/image/thumbnail") || null;
  }

  getThumbnailLink(entry: OPDSEntry): OPDSLink | null {
    // First try to find a dedicated thumbnail
    const thumbnail = entry.links.find((l) => l.rel === "http://opds-spec.org/image/thumbnail");
    if (thumbnail) return thumbnail;
    // Fall back to cover image if no dedicated thumbnail
    return entry.links.find((l) => l.rel === "http://opds-spec.org/image") || null;
  }

  getNavigationLinks(feed: OPDSFeed): OPDSLink[] {
    return feed.links.filter((l) =>
      ["subsection", "next", "previous", "start", "up"].includes(l.rel) ||
      l.rel.startsWith("http://opds-spec.org/sort/"),
    );
  }

  getNextPageLink(feed: OPDSFeed): OPDSLink | null {
    return feed.links.find((l) => l.rel === "next") || null;
  }

  getSearchLink(feed: OPDSFeed): OPDSLink | null {
    return feed.searchLink || feed.links.find((l) => l.rel === "search") || null;
  }
}

export function createOPDSClient(config?: Partial<OPDSClientConfig>): OPDSClient {
  return new OPDSClient(config);
}