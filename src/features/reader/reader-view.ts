/**
 * ReaderViewController
 *
 * Feature component managing the Reader UI overlay:
 * - Header & footer toolbars with immersive mode (auto-hide / toggle on center tap)
 * - 3-zone tap navigation (Left: prev, Center: toggle bars, Right: next)
 * - Touch swipe gestures (swipe left: next, swipe right: prev)
 * - Table of Contents (TOC) slide-out drawer with active section tracking
 * - Typography & layout settings popover (themes, font sizes, families, line spacing, margins)
 * - Interactive progress scrubber slider (goToFraction)
 */

import { FoliateReaderAdapter } from "../../services/reader/foliate-adapter.ts";
import type {
  Reader,
  ReaderTheme,
  ReaderFontFamily,
  ReaderMargin,
  ReaderSettings,
  ReadingPosition,
  BookMetadata,
  TocItem,
} from "../../domain/reader.ts";

export interface ReaderViewElements {
  overlay: HTMLElement;
  mount: HTMLElement;
  backBtn: HTMLButtonElement;
  title: HTMLElement;
  chapter: HTMLElement;
  progressBadge: HTMLElement;
  cfiDisplay: HTMLElement;
  tocBtn: HTMLButtonElement;
  tocDrawer: HTMLElement;
  tocList: HTMLElement;
  tocBackdrop: HTMLElement;
  tocCloseBtn: HTMLButtonElement;
  settingsBtn: HTMLButtonElement;
  settingsDrawer: HTMLElement;
  settingsCloseBtn: HTMLButtonElement;
  prevBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  slider: HTMLInputElement;
  themeButtons: NodeListOf<HTMLButtonElement>;
  fontSizeLabel: HTMLElement;
  smallerFontBtn: HTMLButtonElement;
  largerFontBtn: HTMLButtonElement;
  fontFamilySelect?: HTMLSelectElement;
  lineSpacingSelect?: HTMLSelectElement;
  marginSelect?: HTMLSelectElement;
  tapZoneLeft?: HTMLElement;
  tapZoneCenter?: HTMLElement;
  tapZoneRight?: HTMLElement;
}

export interface ReaderViewCallbacks {
  onSettingsChange?: (settings: ReaderSettings) => void;
  onPositionChange?: (position: ReadingPosition, bookId?: string) => void;
  onClose?: () => void;
}

export class ReaderViewController {
  private elements: ReaderViewElements;
  private reader: Reader | null = null;
  private settings: ReaderSettings;
  private callbacks: ReaderViewCallbacks;
  private currentBookId?: string;
  private activeHref: string | null = null;
  private touchStartX = 0;
  private touchStartY = 0;
  private barsVisible = true;

  constructor(
    elements: ReaderViewElements,
    initialSettings?: Partial<ReaderSettings>,
    callbacks?: ReaderViewCallbacks,
  ) {
    this.elements = elements;
    this.callbacks = callbacks ?? {};
    this.settings = {
      theme: initialSettings?.theme ?? "light",
      fontSize: initialSettings?.fontSize ?? 18,
      lineSpacing: initialSettings?.lineSpacing ?? 1.5,
      fontFamily: initialSettings?.fontFamily ?? "sans-serif",
      margin: initialSettings?.margin ?? "normal",
    };

    this.bindEvents();
    this.syncSettingsUi();
  }

  public getReader(): Reader | null {
    return this.reader;
  }

  public async openBook(
    bookData: Blob | ArrayBuffer | string,
    options?: { bookId?: string; initialPosition?: string },
  ): Promise<void> {
    this.currentBookId = options?.bookId;
    this.elements.overlay.classList.remove("hidden");
    this.elements.title.textContent = "Loading book...";
    this.elements.cfiDisplay.textContent = "initializing...";
    this.setBarsVisible(true);

    if (!this.reader) {
      this.reader = new FoliateReaderAdapter({
        container: this.elements.mount,
        initialSettings: this.settings,
      });

      this.reader.addEventListener("load", (metadata: BookMetadata) => {
        this.elements.title.textContent = metadata.title;
        this.renderToc(metadata.toc ?? []);
      });

      this.reader.addEventListener("relocate", (position: ReadingPosition) => {
        const percent = Math.round(position.progression * 100);
        this.elements.progressBadge.textContent = `${percent}%`;
        this.elements.chapter.textContent = position.title || "Reading";
        this.elements.cfiDisplay.textContent = position.locator || "—";
        this.elements.slider.value = String(position.progression);

        if (position.href) {
          this.activeHref = position.href;
          this.updateActiveTocItem(position.href);
        }

        this.callbacks.onPositionChange?.(position, this.currentBookId);
      });

      this.reader.addEventListener("error", (error) => {
        console.error("Reader controller error:", error);
        this.elements.title.textContent = "Error loading book";
      });
    }

    await this.reader.open(bookData);

    if (options?.initialPosition) {
      try {
        await this.reader.goTo(options.initialPosition);
      } catch (err) {
        console.warn("Could not restore initial reading position:", err);
      }
    }
  }

  public async close(): Promise<void> {
    if (this.reader) {
      await this.reader.close();
      this.reader.destroy();
      this.reader = null;
    }
    this.closeTocDrawer();
    this.closeSettingsDrawer();
    this.elements.overlay.classList.add("hidden");
    this.callbacks.onClose?.();
  }

  public applySettings(newSettings: Partial<ReaderSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    this.syncSettingsUi();
    if (this.reader) {
      if (newSettings.theme) void this.reader.setTheme(this.settings.theme);
      if (newSettings.fontSize) void this.reader.setFontSize(this.settings.fontSize);
      if (newSettings.fontFamily) void this.reader.setFontFamily(this.settings.fontFamily);
      if (newSettings.lineSpacing) void this.reader.setLineSpacing(this.settings.lineSpacing);
      if (newSettings.margin) void this.reader.setMargin(this.settings.margin);
    }
  }

  public getSettings(): ReaderSettings {
    return { ...this.settings };
  }

  public syncSettingsUi(): void {
    this.elements.fontSizeLabel.textContent = `${this.settings.fontSize}px`;
    if (this.elements.fontFamilySelect) {
      this.elements.fontFamilySelect.value = this.settings.fontFamily;
    }
    if (this.elements.lineSpacingSelect) {
      this.elements.lineSpacingSelect.value = String(this.settings.lineSpacing);
    }
    if (this.elements.marginSelect) {
      this.elements.marginSelect.value = this.settings.margin;
    }
    this.elements.themeButtons.forEach((b) => {
      if (b.dataset.theme === this.settings.theme) {
        b.classList.add("active");
      } else {
        b.classList.remove("active");
      }
    });

    const themeBg: Record<ReaderTheme, { bg: string; text: string }> = {
      light: { bg: "#ffffff", text: "#1a1a1a" },
      dark: { bg: "#121212", text: "#e0e0e0" },
      sepia: { bg: "#f4ecd8", text: "#3d2b1f" },
    };
    const t = this.settings.theme;
    if (themeBg[t]) {
      this.elements.overlay.style.backgroundColor = themeBg[t].bg;
      this.elements.overlay.style.color = themeBg[t].text;
    }
  }

  public setBarsVisible(visible: boolean): void {
    this.barsVisible = visible;
    if (visible) {
      this.elements.overlay.classList.remove("bars-hidden");
    } else {
      this.elements.overlay.classList.add("bars-hidden");
    }
  }

  public toggleBars(): void {
    this.setBarsVisible(!this.barsVisible);
  }

  public openTocDrawer(): void {
    this.elements.tocDrawer.classList.remove("hidden");
    this.elements.tocBackdrop.classList.remove("hidden");
    if (this.activeHref) {
      this.updateActiveTocItem(this.activeHref);
    }
  }

  public closeTocDrawer(): void {
    this.elements.tocDrawer.classList.add("hidden");
    this.elements.tocBackdrop.classList.add("hidden");
  }

  public openSettingsDrawer(): void {
    this.elements.settingsDrawer.classList.remove("hidden");
  }

  public closeSettingsDrawer(): void {
    this.elements.settingsDrawer.classList.add("hidden");
  }

  private renderToc(items: TocItem[]): void {
    this.elements.tocList.innerHTML = "";
    if (items.length === 0) {
      const emptyLi = document.createElement("li");
      emptyLi.className = "toc-empty";
      emptyLi.textContent = "No table of contents available";
      this.elements.tocList.appendChild(emptyLi);
      return;
    }

    const buildList = (tocItems: TocItem[], parentUl: HTMLElement) => {
      tocItems.forEach((item) => {
        const li = document.createElement("li");
        li.className = "toc-item";
        li.dataset.href = item.href;

        const a = document.createElement("button");
        a.className = "toc-link";
        a.textContent = item.label;
        a.addEventListener("click", () => {
          void this.reader?.goTo(item.href);
          this.closeTocDrawer();
        });

        li.appendChild(a);

        if (item.subitems && item.subitems.length > 0) {
          const subUl = document.createElement("ul");
          subUl.className = "toc-sublist";
          buildList(item.subitems, subUl);
          li.appendChild(subUl);
        }

        parentUl.appendChild(li);
      });
    };

    buildList(items, this.elements.tocList);
  }

  private updateActiveTocItem(href: string): void {
    const allLinks = this.elements.tocList.querySelectorAll<HTMLButtonElement>(".toc-link");
    allLinks.forEach((link) => link.classList.remove("active"));

    const matchingLi = this.elements.tocList.querySelector<HTMLLIElement>(`li[data-href*="${href}"]`);
    if (matchingLi) {
      const link = matchingLi.querySelector<HTMLButtonElement>(".toc-link");
      link?.classList.add("active");
    }
  }

  private bindEvents(): void {
    // Navigation controls
    this.elements.backBtn.addEventListener("click", () => void this.close());
    this.elements.prevBtn.addEventListener("click", () => void this.reader?.previous());
    this.elements.nextBtn.addEventListener("click", () => void this.reader?.next());

    // Scrubber slider
    this.elements.slider.addEventListener("input", () => {
      const fraction = parseFloat(this.elements.slider.value);
      if (!isNaN(fraction)) {
        void this.reader?.goToFraction(fraction);
      }
    });

    // TOC Drawer
    this.elements.tocBtn.addEventListener("click", () => this.openTocDrawer());
    this.elements.tocCloseBtn.addEventListener("click", () => this.closeTocDrawer());
    this.elements.tocBackdrop.addEventListener("click", () => this.closeTocDrawer());

    // Settings Drawer
    this.elements.settingsBtn.addEventListener("click", () => this.openSettingsDrawer());
    this.elements.settingsCloseBtn.addEventListener("click", () => this.closeSettingsDrawer());

    // 3-Zone Tap Handlers
    this.elements.tapZoneLeft?.addEventListener("click", () => void this.reader?.previous());
    this.elements.tapZoneCenter?.addEventListener("click", () => this.toggleBars());
    this.elements.tapZoneRight?.addEventListener("click", () => void this.reader?.next());

    // Touch Swipe Gestures on Mount Area
    this.elements.mount.addEventListener("touchstart", (e) => {
      const touch = e.touches[0];
      this.touchStartX = touch.clientX;
      this.touchStartY = touch.clientY;
    }, { passive: true });

    this.elements.mount.addEventListener("touchend", (e) => {
      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - this.touchStartX;
      const deltaY = touch.clientY - this.touchStartY;

      // Ensure horizontal swipe dominates vertical scrolling
      if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
        if (deltaX < 0) {
          void this.reader?.next();
        } else {
          void this.reader?.previous();
        }
      }
    }, { passive: true });

    // Font size controls
    this.elements.smallerFontBtn.addEventListener("click", () => {
      this.settings.fontSize = Math.max(12, this.settings.fontSize - 2);
      this.elements.fontSizeLabel.textContent = `${this.settings.fontSize}px`;
      void this.reader?.setFontSize(this.settings.fontSize);
      this.callbacks.onSettingsChange?.(this.settings);
    });

    this.elements.largerFontBtn.addEventListener("click", () => {
      this.settings.fontSize = Math.min(36, this.settings.fontSize + 2);
      this.elements.fontSizeLabel.textContent = `${this.settings.fontSize}px`;
      void this.reader?.setFontSize(this.settings.fontSize);
      this.callbacks.onSettingsChange?.(this.settings);
    });

    // Theme selector
    this.elements.themeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const theme = btn.dataset.theme as ReaderTheme;
        if (!theme) return;
        this.settings.theme = theme;
        this.elements.themeButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        const themeBg: Record<ReaderTheme, { bg: string; text: string }> = {
          light: { bg: "#ffffff", text: "#1a1a1a" },
          dark: { bg: "#121212", text: "#e0e0e0" },
          sepia: { bg: "#f4ecd8", text: "#3d2b1f" },
        };
        this.elements.overlay.style.backgroundColor = themeBg[theme].bg;
        this.elements.overlay.style.color = themeBg[theme].text;

        void this.reader?.setTheme(theme);
        this.callbacks.onSettingsChange?.(this.settings);
      });
    });

    // Font Family selector
    this.elements.fontFamilySelect?.addEventListener("change", () => {
      const family = this.elements.fontFamilySelect?.value as ReaderFontFamily;
      if (family) {
        this.settings.fontFamily = family;
        void this.reader?.setFontFamily(family);
        this.callbacks.onSettingsChange?.(this.settings);
      }
    });

    // Line Spacing selector
    this.elements.lineSpacingSelect?.addEventListener("change", () => {
      const spacing = parseFloat(this.elements.lineSpacingSelect?.value ?? "1.5");
      if (!isNaN(spacing)) {
        this.settings.lineSpacing = spacing;
        void this.reader?.setLineSpacing(spacing);
        this.callbacks.onSettingsChange?.(this.settings);
      }
    });

    // Margin selector
    this.elements.marginSelect?.addEventListener("change", () => {
      const margin = this.elements.marginSelect?.value as ReaderMargin;
      if (margin) {
        this.settings.margin = margin;
        void this.reader?.setMargin(margin);
        this.callbacks.onSettingsChange?.(this.settings);
      }
    });

    // Keyboard navigation
    window.addEventListener("keydown", (e) => {
      if (this.elements.overlay.classList.contains("hidden")) return;
      if (e.key === "Escape") {
        this.closeTocDrawer();
        this.closeSettingsDrawer();
      }
    });
  }
}
