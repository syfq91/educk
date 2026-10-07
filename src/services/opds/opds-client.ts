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
    const facetElements = element.querySelectorAll("opds:facetGroup, facetGroup");

    facetElements.forEach((facetEl) => {
      const name = facetEl.getAttribute("name") || facetEl.getAttribute("term") || "Unknown";
      const values: OPDSFacetValue[] = [];

      const valueElements = facetEl.querySelectorAll("opds:facet, facet");
      valueElements.forEach((valueEl) => {
        const value = valueEl.getAttribute("value") || valueEl.getAttribute("term") || "";
        const countStr = valueEl.getAttribute("count");
        const count = countStr ? parseInt(countStr, 10) : 0;
        const label = valueEl.getAttribute("label") || value;

        if (value) {
          values.push({ value, count, label });
        }
      });

      if (values.length > 0) {
        facets.push({ name, values });
      }
    });

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
    const el = element.querySelector(tagName);
    if (!el) return undefined;
    const value = parseInt(el.textContent || "", 10);
    return isNaN(value) ? undefined : value;
  }

  private getTextContent(element: Element, tagName: string): string | null {
    const el = element.querySelector(tagName);
    return el?.textContent?.trim() || null;
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
    return entry.links.find((l) => l.rel === "http://opds-spec.org/image/thumbnail") || null;
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