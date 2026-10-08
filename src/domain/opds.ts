/**
 * OPDS 1.2 Domain Models
 *
 * OPDS (Open Publication Distribution System) 1.2 is based on Atom Syndication Format (RFC 4287)
 * with extensions for publication metadata (RFC 5988 Web Linking).
 *
 * This module defines the core domain types for OPDS 1.2 navigation and acquisition feeds.
 */

export type OPDSLinkRel =
  | "self"
  | "start"
  | "next"
  | "previous"
  | "up"
  | "subsection"
  | "search"
  | "alternate"
  | "http://opds-spec.org/acquisition"
  | "http://opds-spec.org/acquisition/open-access"
  | "http://opds-spec.org/acquisition/borrow"
  | "http://opds-spec.org/acquisition/buy"
  | "http://opds-spec.org/acquisition/sample"
  | "http://opds-spec.org/acquisition/loan"
  | "http://opds-spec.org/image"
  | "http://opds-spec.org/image/thumbnail"
  | "http://opds-spec.org/progression"
  | "http://opds-spec.org/sort/popular"
  | "http://opds-spec.org/sort/new"
  | "http://opds-spec.org/sort/relevance"
  | "http://opds-spec.org/sort/rating"
  | (string & {});

export type OPDSLinkType =
  | "application/atom+xml;profile=opds-catalog"
  | "application/atom+xml;type=entry"
  | "application/epub+zip"
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "text/html"
  | (string & {});

export interface OPDSLink {
  rel: OPDSLinkRel;
  href: string;
  type?: OPDSLinkType;
  title?: string;
  length?: number;
  // OPDS-specific extensions
  "opds:price"?: string;
  "opds:availability"?: string;
  "opds:commission"?: string;
  "opds:indirectAcquisition"?: OPDSLink[];
}

export interface OPDSPerson {
  name: string;
  uri?: string;
  email?: string;
}

export interface OPDSCategory {
  scheme?: string;
  term: string;
  label?: string;
}

export interface OPDSEntry {
  id: string;
  title: string;
  updated: string;
  published?: string;
  authors: OPDSPerson[];
  contributors?: OPDSPerson[];
  summary?: string;
  content?: string;
  categories: OPDSCategory[];
  links: OPDSLink[];
  rights?: string;
  // OPDS-specific metadata
  "opds:price"?: string;
  "opds:availability"?: string;
  "dcterms:identifier"?: string;
  "dcterms:issued"?: string;
  "dcterms:language"?: string;
  "dcterms:publisher"?: string;
  "dcterms:rights"?: string;
  "dcterms:subject"?: string;
}

export type ServerProfile = "calibre-web" | "komga" | "kavita" | "readarr" | "standard";

export interface OPDSFeed {
  id: string;
  title: string;
  updated: string;
  authors: OPDSPerson[];
  links: OPDSLink[];
  entries: OPDSEntry[];
  // Pagination
  totalResults?: number;
  itemsPerPage?: number;
  startIndex?: number;
  // Search
  searchLink?: OPDSLink;
  // Facets
  facets?: OPDSFacet[];
  // Server compatibility profile
  serverProfile?: ServerProfile;
}

export interface OPDSFacet {
  name: string;
  values: OPDSFacetValue[];
}

export interface OPDSFacetValue {
  value: string;
  count: number;
  label?: string;
  href?: string;
  active?: boolean;
}

// --- Acquisition Types ---

export type AcquisitionType = "open-access" | "borrow" | "buy" | "sample" | "loan";

export interface AcquisitionLink extends OPDSLink {
  rel: "http://opds-spec.org/acquisition" | AcquisitionType;
  type: "application/epub+zip" | "application/pdf" | (string & {});
  length?: number;
  "opds:price"?: string;
  "opds:availability"?: string;
  indirectAcquisition?: OPDSLink[];
}

// --- Authentication ---

export type AuthType = "none" | "basic" | "bearer";

export interface OPDSCatalogAuth {
  type: AuthType;
  username?: string;
  password?: string;
  token?: string;
}

// --- Client Configuration ---

export interface OPDSCatalog {
  id: string;
  name: string;
  url: string;
  auth?: OPDSCatalogAuth;
  lastFetched?: string;
  description?: string;
}

export interface OPDSClientConfig {
  timeout: number;
  userAgent: string;
  maxRetries: number;
  retryDelay: number;
  enableCompatibility?: boolean;
}

export interface OPDSFetchOptions {
  signal?: AbortSignal;
  auth?: OPDSCatalogAuth;
}

// --- Errors ---

export class OPDSError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly url?: string,
  ) {
    super(message);
    this.name = "OPDSError";
  }
}

export class OPDSParseError extends OPDSError {
  constructor(message: string, public readonly xml?: string) {
    super(message, "PARSE_ERROR");
    this.name = "OPDSParseError";
  }
}

export class OPDSNetworkError extends OPDSError {
  constructor(message: string, public readonly originalError: Error, url?: string) {
    super(message, "NETWORK_ERROR", undefined, url);
    this.name = "OPDSNetworkError";
  }
}

export class OPDSAuthError extends OPDSError {
  constructor(message: string, url?: string) {
    super(message, "AUTH_ERROR", 401, url);
    this.name = "OPDSAuthError";
  }
}

// --- Navigation State ---

export interface OPDSNavigationState {
  catalogId: string;
  feedUrl: string;
  breadcrumbs: OPDSBreadcrumb[];
  currentFeed: OPDSFeed | null;
  isLoading: boolean;
  error: string | null;
}

export interface OPDSBreadcrumb {
  title: string;
  feedUrl: string;
}

// --- Search ---

export interface OPDSSearchQuery {
  q?: string;
  count?: number;
  startIndex?: number;
}