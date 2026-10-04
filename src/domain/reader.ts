/**
 * Pure domain interfaces and types for the educk Reader abstraction.
 * Decouples the application UI and storage from foliate-js rendering details.
 */

export interface ReadingPosition {
  bookId?: string;
  progression: number; // 0.0 to 1.0 (0% to 100%)
  locator: string;     // EPUB Canonical Fragment Identifier (CFI)
  href?: string;       // Spine item href (e.g. 'text/ch1.xhtml')
  title?: string;      // Chapter or section title
  modifiedAt?: string; // ISO 8601 UTC timestamp
}

export type ReaderTheme = "light" | "dark" | "sepia";

export interface ReaderSettings {
  theme: ReaderTheme;
  fontSize: number;    // in px (e.g. 16)
  lineSpacing: number; // e.g. 1.4
  fontFamily: string;  // e.g. 'sans-serif', 'serif'
}

export interface BookMetadata {
  title: string;
  author?: string;
  description?: string;
  language?: string;
  identifier?: string;
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
  error: (error: Error) => void;
}

export interface Reader {
  open(bookData: Blob | ArrayBuffer | string): Promise<void>;
  close(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  goTo(locator: string): Promise<void>;
  getPosition(): Promise<ReadingPosition | null>;
  setPosition(position: ReadingPosition): Promise<void>;
  getMetadata?(): Promise<BookMetadata | null>;
  setTheme(theme: ReaderTheme): Promise<void>;
  setFontSize(size: number): Promise<void>;
  destroy(): void;
  addEventListener<K extends keyof ReaderEventMap>(event: K, handler: ReaderEventMap[K]): void;
  removeEventListener<K extends keyof ReaderEventMap>(event: K, handler: ReaderEventMap[K]): void;
}
