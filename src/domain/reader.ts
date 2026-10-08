/**
 * Pure domain interfaces, types, and error classes for the educk Reader abstraction.
 * Decouples the application UI, storage, and synchronization layers from foliate-js rendering details.
 */

// --- Domain Errors ---

export class ReaderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReaderError";
  }
}

export class BookLoadError extends ReaderError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BookLoadError";
  }
}

export class NavigationError extends ReaderError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NavigationError";
  }
}

export class UnsupportedFormatError extends ReaderError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UnsupportedFormatError";
  }
}

// --- Domain Models & Settings ---

export interface ReadingPosition {
  bookId?: string;
  progression: number; // 0.0 to 1.0 (0% to 100%)
  locator: string;     // EPUB Canonical Fragment Identifier (CFI)
  href?: string;       // Spine item href (e.g. 'text/ch1.xhtml')
  title?: string;      // Chapter or section title
  modifiedAt?: string; // ISO 8601 UTC timestamp
}

export type ReaderTheme = "light" | "dark" | "sepia" | "amoled";

export type ReaderFontFamily = "sans-serif" | "serif" | "monospace" | "opendyslexic";

export type ReaderMargin = "narrow" | "normal" | "wide";

export type ReaderState = "uninitialized" | "loading" | "ready" | "error" | "closed";

export interface ReaderSettings {
  theme: ReaderTheme;
  fontSize: number;          // in px (12 to 36)
  lineSpacing: number;       // e.g. 1.2, 1.5, 1.8
  fontFamily: ReaderFontFamily;
  margin: ReaderMargin;      // narrow (12px), normal (24px), wide (40px)
}

export interface BookMetadata {
  title: string;
  author?: string;
  description?: string;
  language?: string;
  identifier?: string;
  publisher?: string;
  rights?: string;
  toc?: TocItem[];
}

export interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[];
}

export interface ReaderEventMap {
  relocate: (position: ReadingPosition) => void;
  load: (metadata: BookMetadata) => void;
  error: (error: ReaderError) => void;
  statechange: (state: ReaderState) => void;
}

// --- Core Reader Contract ---

export interface Reader {
  open(bookData: Blob | ArrayBuffer | string): Promise<void>;
  close(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  goTo(locator: string): Promise<void>;
  goToFraction(fraction: number): Promise<void>;
  getPosition(): Promise<ReadingPosition | null>;
  setPosition(position: ReadingPosition): Promise<void>;
  getMetadata(): Promise<BookMetadata | null>;
  getToc(): Promise<TocItem[]>;
  setTheme(theme: ReaderTheme): Promise<void>;
  setFontSize(size: number): Promise<void>;
  setFontFamily(family: ReaderFontFamily): Promise<void>;
  setLineSpacing(spacing: number): Promise<void>;
  setMargin(margin: ReaderMargin): Promise<void>;
  getState(): ReaderState;
  destroy(): void;
  addEventListener<K extends keyof ReaderEventMap>(event: K, handler: ReaderEventMap[K]): void;
  removeEventListener<K extends keyof ReaderEventMap>(event: K, handler: ReaderEventMap[K]): void;
}
