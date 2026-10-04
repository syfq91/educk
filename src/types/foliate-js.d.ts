/**
 * Ambient type definitions for vendored foliate-js rendering engine.
 */

declare module "*/vendor/foliate-js/view.js" {
  export class View extends HTMLElement {
    book?: FoliateBook;
    renderer?: FoliateRenderer;
    lastLocation?: unknown;
    open(book: unknown): Promise<void>;
    close(): void;
    next(): Promise<void>;
    prev(): Promise<void>;
    goLeft(): Promise<void>;
    goRight(): Promise<void>;
    goTo(locator: string | number): Promise<void>;
    goToFraction(fraction: number): Promise<void>;
    getSectionFractions(): number[];
    resolveNavigation(target: string | number): unknown;
    init(options: { lastLocation?: unknown; showTextStart?: boolean }): Promise<void>;
  }

  export const makeBook: (file: unknown) => Promise<FoliateBook>;
}

export interface FoliateBook {
  metadata?: {
    title?: string | Record<string, string>;
    author?: string | Record<string, string> | Array<string | { name: string }>;
    description?: string;
    language?: string;
    identifier?: string;
  };
  toc?: FoliateTocItem[];
  sections: Array<{
    id: string;
    href: string;
    linear?: string;
    mediaOverlay?: unknown;
    load(): Promise<string | Document>;
    unload(): void;
  }>;
  dir?: string;
  landmarks?: Array<{ type: string; href: string }>;
  getCover?(): Promise<Blob | null>;
  loadBlob?(href: string): Promise<Blob>;
  transformTarget?: EventTarget;
}

export interface FoliateTocItem {
  label: string;
  href: string;
  subitems?: FoliateTocItem[];
}

export interface FoliateRenderer extends HTMLElement {
  next(): Promise<void>;
  prev(): Promise<void>;
  goTo(target: unknown): Promise<void>;
  setStyles?(css: string): void;
  destroy?(): void;
  getContents?(): Array<{ doc: Document; index: number }>;
}

declare global {
  interface HTMLElementTagNameMap {
    "foliate-view": import("*/vendor/foliate-js/view.js").View;
  }
}
