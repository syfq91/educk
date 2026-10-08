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
  clockDisplay?: HTMLElement;
  batteryDisplay?: HTMLElement;
  fontSizeSlider?: HTMLInputElement;
  settingsFontSizeLabel?: HTMLElement;
}

interface BatteryManagerLike {
  level: number;
  charging: boolean;
  addEventListener: (event: string, handler: () => void) => void;
  removeEventListener?: (event: string, handler: () => void) => void;
}

export interface ReaderViewCallbacks {
  onSettingsChange?: (settings: ReaderSettings) => void;
  onPositionChange?: (position: ReadingPosition, bookId?: string) => void;
  onBeforeClose?: () => Promise<void> | void;
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
  private clockInterval: ReturnType<typeof setInterval> | null = null;
  private batteryManager: BatteryManagerLike | null = null;
  private onBatteryChange: (() => void) | null = null;
  private wakeLockSentinel: { release: () => Promise<void> } | null = null;

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
    this.updateClock();
    this.clockInterval = setInterval(() => this.updateClock(), 30000);
    void this.initBattery();
  }

  public getReader(): Reader | null {
    return this.reader;
  }

  public async openBook(
    bookData: Blob | ArrayBuffer | string,
    options?: { bookId?: string; initialPosition?: string; initialProgression?: number },
  ): Promise<void> {
    this.currentBookId = options?.bookId;
    this.elements.overlay.classList.remove("hidden");
    this.elements.title.textContent = "Loading book...";
    this.elements.cfiDisplay.textContent = "initializing...";
    this.updateClock();
    void this.acquireWakeLock();
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
        console.warn("Could not restore initial reading position via locator CFI:", err);
        // Fallback recovery: try fractional progression if provided
        if (typeof options.initialProgression === "number" && options.initialProgression > 0) {
          try {
            await this.reader.goToFraction(options.initialProgression);
          } catch (fracErr) {
            console.warn("Could not restore reading position via fraction fallback:", fracErr);
          }
        }
      }
    } else if (typeof options?.initialProgression === "number" && options.initialProgression > 0) {
      try {
        await this.reader.goToFraction(options.initialProgression);
      } catch (fracErr) {
        console.warn("Could not set initial reading position via fraction:", fracErr);
      }
    }
  }

  public async close(): Promise<void> {
    void this.releaseWakeLock();
    if (this.callbacks.onBeforeClose) {
      try {
        await this.callbacks.onBeforeClose();
      } catch (err) {
        console.warn("Error in onBeforeClose callback:", err);
      }
    }
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

  public async goTo(locator: string): Promise<void> {
    if (this.reader) {
      await this.reader.goTo(locator);
    }
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
    if (this.elements.fontSizeSlider) {
      this.elements.fontSizeSlider.value = String(this.settings.fontSize);
    }
    if (this.elements.settingsFontSizeLabel) {
      this.elements.settingsFontSizeLabel.textContent = `${this.settings.fontSize}px`;
    }
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
      amoled: { bg: "#000000", text: "#d4d4d4" },
    };
    const t = this.settings.theme;
    if (themeBg[t]) {
      this.elements.overlay.style.backgroundColor = themeBg[t].bg;
      this.elements.overlay.style.color = themeBg[t].text;
    }

    if (t === "amoled") {
      this.elements.overlay.classList.add("theme-amoled");
    } else {
      this.elements.overlay.classList.remove("theme-amoled");
    }
  }

  private updateClock(): void {
    if (this.elements.clockDisplay) {
      const now = new Date();
      this.elements.clockDisplay.textContent = now.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }

  private async initBattery(): Promise<void> {
    if (typeof navigator !== "undefined" && "getBattery" in navigator) {
      try {
        const nav = navigator as unknown as { getBattery: () => Promise<BatteryManagerLike> };
        if (typeof nav.getBattery === "function") {
          const battery = await nav.getBattery();
          this.batteryManager = battery;
          this.onBatteryChange = () => {
            if (this.elements.batteryDisplay) {
              const pct = Math.round(battery.level * 100);
              const icon = battery.charging ? "⚡" : "🔋";
              this.elements.batteryDisplay.textContent = `${icon} ${pct}%`;
              this.elements.batteryDisplay.classList.remove("hidden");
            }
          };
          this.onBatteryChange();
          battery.addEventListener("levelchange", this.onBatteryChange);
          battery.addEventListener("chargingchange", this.onBatteryChange);
        }
      } catch {
        // Battery status not accessible
      }
    }
  }

  private async acquireWakeLock(): Promise<void> {
    if (typeof navigator !== "undefined" && "wakeLock" in navigator) {
      try {
        const nav = navigator as unknown as {
          wakeLock: { request: (type: string) => Promise<{ release: () => Promise<void> }> };
        };
        if (nav.wakeLock && typeof nav.wakeLock.request === "function") {
          this.wakeLockSentinel = await nav.wakeLock.request("screen");
        }
      } catch {
        // WakeLock request denied or unsupported
      }
    }
  }

  private async releaseWakeLock(): Promise<void> {
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
      } catch {
        // Ignore release errors
      }
      this.wakeLockSentinel = null;
    }
  }

  public destroy(): void {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
    if (this.batteryManager && this.onBatteryChange) {
      this.batteryManager.removeEventListener?.("levelchange", this.onBatteryChange);
      this.batteryManager.removeEventListener?.("chargingchange", this.onBatteryChange);
      this.batteryManager = null;
      this.onBatteryChange = null;
    }
    void this.releaseWakeLock();
    if (this.reader) {
      this.reader.destroy();
      this.reader = null;
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
    this.elements.fontSizeSlider?.addEventListener("input", () => {
      const val = parseInt(this.elements.fontSizeSlider!.value, 10);
      if (!isNaN(val)) {
        this.settings.fontSize = Math.max(12, Math.min(36, val));
        this.elements.fontSizeLabel.textContent = `${this.settings.fontSize}px`;
        if (this.elements.settingsFontSizeLabel) {
          this.elements.settingsFontSizeLabel.textContent = `${this.settings.fontSize}px`;
        }
        void this.reader?.setFontSize(this.settings.fontSize);
        this.callbacks.onSettingsChange?.(this.settings);
      }
    });

    this.elements.smallerFontBtn.addEventListener("click", () => {
      this.settings.fontSize = Math.max(12, this.settings.fontSize - 2);
      this.elements.fontSizeLabel.textContent = `${this.settings.fontSize}px`;
      if (this.elements.fontSizeSlider) {
        this.elements.fontSizeSlider.value = String(this.settings.fontSize);
      }
      if (this.elements.settingsFontSizeLabel) {
        this.elements.settingsFontSizeLabel.textContent = `${this.settings.fontSize}px`;
      }
      void this.reader?.setFontSize(this.settings.fontSize);
      this.callbacks.onSettingsChange?.(this.settings);
    });

    this.elements.largerFontBtn.addEventListener("click", () => {
      this.settings.fontSize = Math.min(36, this.settings.fontSize + 2);
      this.elements.fontSizeLabel.textContent = `${this.settings.fontSize}px`;
      if (this.elements.fontSizeSlider) {
        this.elements.fontSizeSlider.value = String(this.settings.fontSize);
      }
      if (this.elements.settingsFontSizeLabel) {
        this.elements.settingsFontSizeLabel.textContent = `${this.settings.fontSize}px`;
      }
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
          amoled: { bg: "#000000", text: "#d4d4d4" },
        };
        const tBg = themeBg[theme] || themeBg.light;
        this.elements.overlay.style.backgroundColor = tBg.bg;
        this.elements.overlay.style.color = tBg.text;
        if (theme === "amoled") {
          this.elements.overlay.classList.add("theme-amoled");
        } else {
          this.elements.overlay.classList.remove("theme-amoled");
        }

        void this.reader?.setTheme(theme);
        this.callbacks.onSettingsChange?.(this.settings);
      });
    });

    // Visibility-aware screen wake lock
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !this.elements.overlay.classList.contains("hidden")) {
        void this.acquireWakeLock();
      } else if (document.visibilityState === "hidden") {
        void this.releaseWakeLock();
      }
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
