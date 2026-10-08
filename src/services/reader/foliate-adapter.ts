/**
 * FoliateReaderAdapter
 *
 * Implements the production domain Reader interface using vendored foliate-js.
 * Encapsulates the <foliate-view> web component, handles events, manages styles,
 * forwards keyboard navigation, and enforces strict security sandboxing.
 */

import {
  type Reader,
  type ReadingPosition,
  type ReaderTheme,
  type ReaderFontFamily,
  type ReaderMargin,
  type ReaderSettings,
  type ReaderState,
  type ReaderEventMap,
  type BookMetadata,
  type TocItem,
  BookLoadError,
  NavigationError,
} from "../../domain/reader.ts";

import type { FoliateTocItem } from "../../types/foliate-js.d.ts";

// Import custom element registration from vendored foliate-js
import "../../../vendor/foliate-js/view.js";

export interface FoliateAdapterOptions {
  container: HTMLElement;
  initialSettings?: Partial<ReaderSettings>;
}

export class FoliateReaderAdapter implements Reader {
  private container: HTMLElement;
  private view: HTMLElementTagNameMap["foliate-view"] | null = null;
  private settings: ReaderSettings;
  private state: ReaderState = "uninitialized";
  private currentPosition: ReadingPosition | null = null;
  private currentMetadata: BookMetadata | null = null;
  private listeners: Map<keyof ReaderEventMap, Set<ReaderEventMap[keyof ReaderEventMap]>> = new Map();

  constructor(options: FoliateAdapterOptions) {
    this.container = options.container;
    this.settings = {
      theme: options.initialSettings?.theme ?? "light",
      fontSize: options.initialSettings?.fontSize ?? 18,
      lineSpacing: options.initialSettings?.lineSpacing ?? 1.5,
      fontFamily: options.initialSettings?.fontFamily ?? "sans-serif",
      margin: options.initialSettings?.margin ?? "normal",
    };
  }

  public getState(): ReaderState {
    return this.state;
  }

  private setState(newState: ReaderState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.dispatchEvent("statechange", newState);
    }
  }

  public async open(bookData: Blob | ArrayBuffer | string): Promise<void> {
    await this.close();
    this.setState("loading");

    // Normalize ArrayBuffer to Blob with EPUB MIME type
    let fileInput: Blob | string;
    if (bookData instanceof ArrayBuffer) {
      fileInput = new Blob([bookData], { type: "application/epub+zip" });
    } else {
      fileInput = bookData;
    }

    if (fileInput instanceof Blob && !("name" in fileInput)) {
      Object.defineProperty(fileInput, "name", { value: "book.epub", configurable: true });
    }

    // Create and attach <foliate-view> custom element
    const view = document.createElement("foliate-view");
    this.view = view;
    this.container.appendChild(view);

    // Bind relocation events
    view.addEventListener("relocate", this.handleRelocate.bind(this));

    // Forward keyboard events from inside section iframes
    view.addEventListener("load", (event: Event) => {
      const customEvent = event as CustomEvent<{ doc?: Document }>;
      const doc = customEvent.detail?.doc;
      if (doc) {
        doc.addEventListener("keydown", (e: KeyboardEvent) => {
          this.handleKeydown(e);
        });
      }
    });

    try {
      await view.open(fileInput);
    } catch (err) {
      this.setState("error");
      const loadError = new BookLoadError(
        `Failed to open book: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
      this.dispatchEvent("error", loadError);
      throw loadError;
    }

    // Security Hardening: suppress script execution in book resources
    const book = view.book;
    if (book?.transformTarget) {
      book.transformTarget.addEventListener("data", (event: Event) => {
        const customEvent = event as CustomEvent<{ name?: string; data?: unknown }>;
        const name = customEvent.detail?.name?.toLowerCase() ?? "";
        if (name.endsWith(".js") || name.endsWith(".mjs")) {
          // Neutralize script assets by returning blank
          customEvent.detail.data = "";
        }
      });
    }

    // Apply reader typography & theme styles
    this.applyStyles();

    // Advance renderer to initial frame if paginated
    if (view.renderer?.next) {
      await view.renderer.next();
    }

    // Extract book metadata & TOC
    if (book?.metadata) {
      const rawTitle = book.metadata.title;
      let titleStr = "Untitled Book";
      if (typeof rawTitle === "string") {
        titleStr = rawTitle;
      } else if (typeof rawTitle === "object" && rawTitle !== null) {
        const firstVal = Object.values(rawTitle)[0];
        if (typeof firstVal === "string") {
          titleStr = firstVal;
        }
      }

      const rawAuthor = book.metadata.author;
      let authorStr: string | undefined;
      if (typeof rawAuthor === "string") {
        authorStr = rawAuthor;
      } else if (Array.isArray(rawAuthor)) {
        authorStr = rawAuthor
          .map((a) => (typeof a === "string" ? a : a?.name ?? ""))
          .filter(Boolean)
          .join(", ");
      } else if (typeof rawAuthor === "object" && rawAuthor !== null) {
        const firstVal = Object.values(rawAuthor)[0];
        if (typeof firstVal === "string") {
          authorStr = firstVal;
        }
      }

      const rawToc = (book.toc ?? []) as FoliateTocItem[];
      const tocItems: TocItem[] = this.normalizeToc(rawToc);

      const metadata: BookMetadata = {
        title: titleStr,
        author: authorStr,
        description: book.metadata.description,
        language: book.metadata.language,
        identifier: book.metadata.identifier,
        toc: tocItems,
      };

      this.currentMetadata = metadata;
      this.dispatchEvent("load", metadata);
    }

    this.setState("ready");
  }

  private normalizeToc(items: FoliateTocItem[]): TocItem[] {
    return items.map((t) => ({
      label: t.label || "Untitled Section",
      href: t.href,
      subitems: t.subitems && t.subitems.length > 0 ? this.normalizeToc(t.subitems) : undefined,
    }));
  }

  public async close(): Promise<void> {
    if (this.view) {
      try {
        this.view.close();
      } catch {
        // Ignore close error during teardown
      }
      this.view.remove();
      this.view = null;
    }
    this.currentPosition = null;
    this.currentMetadata = null;
    this.setState("closed");
  }

  public async next(): Promise<void> {
    if (!this.view || this.state !== "ready") return;
    if (this.view.goRight) {
      await this.view.goRight();
    } else if (this.view.renderer?.next) {
      await this.view.renderer.next();
    }
  }

  public async previous(): Promise<void> {
    if (!this.view || this.state !== "ready") return;
    if (this.view.goLeft) {
      await this.view.goLeft();
    } else if (this.view.renderer?.prev) {
      await this.view.renderer.prev();
    }
  }

  public async goTo(locator: string): Promise<void> {
    if (!this.view || this.state !== "ready") return;
    try {
      await this.view.goTo(locator);
    } catch (err) {
      const navError = new NavigationError(
        `Failed to navigate to locator "${locator}": ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
      this.dispatchEvent("error", navError);
      throw navError;
    }
  }

  public async goToFraction(fraction: number): Promise<void> {
    if (!this.view || this.state !== "ready") return;
    const clamped = Math.max(0, Math.min(1, fraction));
    try {
      if (this.view.goToFraction) {
        await this.view.goToFraction(clamped);
      }
    } catch (err) {
      const navError = new NavigationError(
        `Failed to navigate to fraction ${clamped}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
      this.dispatchEvent("error", navError);
      throw navError;
    }
  }

  public async getPosition(): Promise<ReadingPosition | null> {
    return this.currentPosition;
  }

  public async setPosition(position: ReadingPosition): Promise<void> {
    if (position.locator) {
      await this.goTo(position.locator);
    }
  }

  public async getMetadata(): Promise<BookMetadata | null> {
    return this.currentMetadata;
  }

  public async getToc(): Promise<TocItem[]> {
    return this.currentMetadata?.toc ?? [];
  }

  public async setTheme(theme: ReaderTheme): Promise<void> {
    this.settings.theme = theme;
    this.applyStyles();
  }

  public async setFontSize(size: number): Promise<void> {
    this.settings.fontSize = Math.max(12, Math.min(36, size));
    this.applyStyles();
  }

  public async setFontFamily(family: ReaderFontFamily): Promise<void> {
    this.settings.fontFamily = family;
    this.applyStyles();
  }

  public async setLineSpacing(spacing: number): Promise<void> {
    this.settings.lineSpacing = Math.max(1.1, Math.min(2.5, spacing));
    this.applyStyles();
  }

  public async setMargin(margin: ReaderMargin): Promise<void> {
    this.settings.margin = margin;
    this.applyStyles();
  }

  public destroy(): void {
    void this.close();
    this.listeners.clear();
  }

  public addEventListener<K extends keyof ReaderEventMap>(
    event: K,
    handler: ReaderEventMap[K],
  ): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as ReaderEventMap[keyof ReaderEventMap]);
  }

  public removeEventListener<K extends keyof ReaderEventMap>(
    event: K,
    handler: ReaderEventMap[K],
  ): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(handler as ReaderEventMap[keyof ReaderEventMap]);
    }
  }

  private dispatchEvent<K extends keyof ReaderEventMap>(
    event: K,
    payload: Parameters<ReaderEventMap[K]>[0],
  ): void {
    const set = this.listeners.get(event);
    if (set) {
      set.forEach((handler) => {
        try {
          (handler as (p: typeof payload) => void)(payload);
        } catch (err) {
          console.error(`Error in reader event handler for "${event}":`, err);
        }
      });
    }
  }

  private handleRelocate(event: Event): void {
    const customEvent = event as CustomEvent<{
      cfi?: string;
      fraction?: number;
      location?: unknown;
      tocItem?: { label?: string; href?: string };
    }>;
    const detail = customEvent.detail;
    if (!detail) return;

    const progression = typeof detail.fraction === "number" ? Math.max(0, Math.min(1, detail.fraction)) : 0.0;
    const locator = detail.cfi ?? "";

    this.currentPosition = {
      progression,
      locator,
      href: detail.tocItem?.href,
      title: detail.tocItem?.label,
      modifiedAt: new Date().toISOString(),
    };

    this.dispatchEvent("relocate", this.currentPosition);
  }

  private handleKeydown(event: KeyboardEvent): void {
    const key = event.key;
    if (key === "ArrowRight" || key === "PageDown") {
      void this.next();
    } else if (key === "ArrowLeft" || key === "PageUp") {
      void this.previous();
    } else if (key === " " && !event.shiftKey) {
      void this.next();
    } else if (key === " " && event.shiftKey) {
      void this.previous();
    }
  }

  private applyStyles(): void {
    if (!this.view?.renderer?.setStyles) return;

    const themeColors: Record<ReaderTheme, { bg: string; text: string; link: string }> = {
      light: { bg: "#ffffff", text: "#1a1a1a", link: "#0066cc" },
      dark: { bg: "#121212", text: "#e0e0e0", link: "#66b3ff" },
      sepia: { bg: "#f4ecd8", text: "#3d2b1f", link: "#7a4b22" },
      amoled: { bg: "#000000", text: "#d4d4d4", link: "#4da6ff" },
    };

    const fontFamilies: Record<ReaderFontFamily, string> = {
      "sans-serif": '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      serif: 'Georgia, "Times New Roman", Cambria, serif',
      monospace: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      opendyslexic: '"OpenDyslexic", "Comic Sans MS", cursive, sans-serif',
    };

    const margins: Record<ReaderMargin, number> = {
      narrow: 12,
      normal: 24,
      wide: 40,
    };

    const colors = themeColors[this.settings.theme] || themeColors.light;
    const fontFamily = fontFamilies[this.settings.fontFamily] || fontFamilies["sans-serif"];
    const marginPx = margins[this.settings.margin] ?? 24;
    const isDark = this.settings.theme === "dark" || this.settings.theme === "amoled";
    const dyslexicSpacing = this.settings.fontFamily === "opendyslexic" ? "letter-spacing: 0.03em; word-spacing: 0.05em;" : "";

    const css = `
      html {
        color-scheme: ${isDark ? "dark" : "light"};
        background-color: ${colors.bg} !important;
        color: ${colors.text} !important;
      }
      body {
        background-color: ${colors.bg} !important;
        color: ${colors.text} !important;
        font-family: ${fontFamily} !important;
        font-size: ${this.settings.fontSize}px !important;
        line-height: ${this.settings.lineSpacing} !important;
        ${dyslexicSpacing}
        margin: 0 !important;
        padding: 0 ${marginPx}px !important;
      }
      p, li, dd, blockquote {
        line-height: ${this.settings.lineSpacing} !important;
        text-align: justify;
      }
      a {
        color: ${colors.link} !important;
      }
    `;

    this.view.renderer.setStyles(css);
  }
}
