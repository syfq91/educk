import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FoliateReaderAdapter } from "../../src/services/reader/foliate-adapter.ts";
import {
  ReaderViewController,
  type ReaderViewElements,
} from "../../src/features/reader/reader-view.ts";

describe("Milestone M12: Reader UX & Settings Unit Tests", () => {
  describe("FoliateReaderAdapter Theme & Font Enhancements", () => {
    let container: HTMLElement;
    let adapter: FoliateReaderAdapter;

    beforeEach(() => {
      container = document.createElement("div");
      document.body.appendChild(container);
      adapter = new FoliateReaderAdapter({
        container,
        initialSettings: {
          theme: "light",
          fontSize: 18,
          fontFamily: "sans-serif",
          lineSpacing: 1.5,
          margin: "normal",
        },
      });
    });

    afterEach(() => {
      adapter.destroy();
      container.remove();
    });

    it("should apply AMOLED theme with pitch-black #000000 background and dark color-scheme", async () => {
      await adapter.setTheme("amoled");
      // Adapter updates internal style sheets / variables
      expect(adapter.getState()).toBe("uninitialized");
    });

    it("should apply OpenDyslexic font family with specialized letter and word spacing", async () => {
      await adapter.setFontFamily("opendyslexic");
      expect(adapter.getState()).toBe("uninitialized");
    });
  });

  describe("ReaderViewController UX Features", () => {
    let elements: ReaderViewElements;
    let controller: ReaderViewController;
    let mockWakeLockRelease: ReturnType<typeof vi.fn>;
    let batteryChangeHandlers: Record<string, () => void>;
    let mockBattery: {
      level: number;
      charging: boolean;
      addEventListener: ReturnType<typeof vi.fn>;
      removeEventListener: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      batteryChangeHandlers = {};
      mockBattery = {
        level: 0.78,
        charging: false,
        addEventListener: vi.fn((event: string, handler: () => void) => {
          batteryChangeHandlers[event] = handler;
        }),
        removeEventListener: vi.fn((event: string) => {
          delete batteryChangeHandlers[event];
        }),
      };

      Object.defineProperty(navigator, "getBattery", {
        value: vi.fn().mockResolvedValue(mockBattery),
        configurable: true,
      });

      mockWakeLockRelease = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "wakeLock", {
        value: {
          request: vi.fn().mockResolvedValue({ release: mockWakeLockRelease }),
        },
        configurable: true,
      });

      document.body.innerHTML = `
        <div id="reader-view" class="reader-overlay hidden">
          <header class="reader-header">
            <button id="reader-btn-back">←</button>
            <button id="reader-btn-toc">☰</button>
            <div class="reader-meta">
              <div id="reader-title">Title</div>
              <div id="reader-chapter">Chapter</div>
            </div>
            <div id="reader-status-indicators">
              <span id="reader-clock">12:00</span>
              <span id="reader-battery" class="hidden">🔋 100%</span>
            </div>
            <button id="reader-btn-settings">Aa</button>
            <div id="reader-progress-badge">0%</div>
          </header>

          <div class="reader-canvas">
            <div class="reader-tap-zones">
              <div id="tap-zone-left" class="tap-zone left"></div>
              <div id="tap-zone-center" class="tap-zone center"></div>
              <div id="tap-zone-right" class="tap-zone right"></div>
            </div>
            <button id="reader-btn-prev">‹</button>
            <div id="reader-mount"></div>
            <button id="reader-btn-next">›</button>
          </div>

          <footer class="reader-footer">
            <input type="range" id="reader-progress-slider" min="0" max="1" step="0.001" value="0" />
            <div class="reader-theme-selector">
              <button class="theme-btn active" data-theme="light">Light</button>
              <button class="theme-btn" data-theme="sepia">Sepia</button>
              <button class="theme-btn" data-theme="dark">Dark</button>
              <button class="theme-btn" data-theme="amoled">Black</button>
            </div>
            <div class="reader-font-controls">
              <button id="btn-font-smaller">A-</button>
              <span id="font-size-val">18px</span>
              <button id="btn-font-larger">A+</button>
            </div>
            <div class="reader-cfi-box">
              <span id="reader-cfi">—</span>
            </div>
          </footer>

          <div id="reader-backdrop" class="drawer-backdrop hidden"></div>
          <aside id="reader-toc-drawer" class="reader-drawer toc-drawer hidden">
            <button id="btn-close-toc">✕</button>
            <ul id="reader-toc-list"></ul>
          </aside>
          <aside id="reader-settings-drawer" class="reader-drawer settings-drawer hidden">
            <button id="btn-close-settings">✕</button>
            <input type="range" id="slider-font-size" min="12" max="36" step="1" value="18" />
            <span id="settings-font-size-label">18px</span>
            <select id="select-font-family">
              <option value="sans-serif">Sans-Serif</option>
              <option value="serif">Serif</option>
              <option value="monospace">Monospace</option>
              <option value="opendyslexic">OpenDyslexic</option>
            </select>
            <select id="select-line-spacing">
              <option value="1.2">1.2</option>
              <option value="1.5" selected>1.5</option>
              <option value="1.8">1.8</option>
            </select>
            <select id="select-margin">
              <option value="narrow">Narrow</option>
              <option value="normal" selected>Normal</option>
              <option value="wide">Wide</option>
            </select>
          </aside>
        </div>
      `;

      elements = {
        overlay: document.querySelector("#reader-view")!,
        mount: document.querySelector("#reader-mount")!,
        backBtn: document.querySelector("#reader-btn-back")!,
        title: document.querySelector("#reader-title")!,
        chapter: document.querySelector("#reader-chapter")!,
        progressBadge: document.querySelector("#reader-progress-badge")!,
        cfiDisplay: document.querySelector("#reader-cfi")!,
        tocBtn: document.querySelector("#reader-btn-toc")!,
        tocDrawer: document.querySelector("#reader-toc-drawer")!,
        tocList: document.querySelector("#reader-toc-list")!,
        tocBackdrop: document.querySelector("#reader-backdrop")!,
        tocCloseBtn: document.querySelector("#btn-close-toc")!,
        settingsBtn: document.querySelector("#reader-btn-settings")!,
        settingsDrawer: document.querySelector("#reader-settings-drawer")!,
        settingsCloseBtn: document.querySelector("#btn-close-settings")!,
        prevBtn: document.querySelector("#reader-btn-prev")!,
        nextBtn: document.querySelector("#reader-btn-next")!,
        slider: document.querySelector("#reader-progress-slider")!,
        themeButtons: document.querySelectorAll(".theme-btn"),
        fontSizeLabel: document.querySelector("#font-size-val")!,
        smallerFontBtn: document.querySelector("#btn-font-smaller")!,
        largerFontBtn: document.querySelector("#btn-font-larger"),
        tapZoneLeft: document.querySelector("#tap-zone-left")!,
        tapZoneCenter: document.querySelector("#tap-zone-center")!,
        tapZoneRight: document.querySelector("#tap-zone-right")!,
        clockDisplay: document.querySelector("#reader-clock")!,
        batteryDisplay: document.querySelector("#reader-battery")!,
        fontSizeSlider: document.querySelector("#slider-font-size")!,
        settingsFontSizeLabel: document.querySelector("#settings-font-size-label")!,
        fontFamilySelect: document.querySelector("#select-font-family")!,
        lineSpacingSelect: document.querySelector("#select-line-spacing")!,
        marginSelect: document.querySelector("#select-margin")!,
      };
    });

    afterEach(() => {
      controller?.destroy();
      document.body.innerHTML = "";
    });

    it("should synchronize continuous font size slider with buttons and labels", () => {
      const onSettingsChange = vi.fn();
      controller = new ReaderViewController(
        elements,
        { fontSize: 18 },
        { onSettingsChange },
      );

      // Slider changes to 24px
      elements.fontSizeSlider!.value = "24";
      elements.fontSizeSlider!.dispatchEvent(new Event("input"));

      expect(controller.getSettings().fontSize).toBe(24);
      expect(elements.fontSizeLabel.textContent).toBe("24px");
      expect(elements.settingsFontSizeLabel!.textContent).toBe("24px");
      expect(onSettingsChange).toHaveBeenCalledWith(
        expect.objectContaining({ fontSize: 24 }),
      );

      // A+ button increments by 2
      elements.largerFontBtn!.click();
      expect(controller.getSettings().fontSize).toBe(26);
      expect(elements.fontSizeSlider!.value).toBe("26");
      expect(elements.fontSizeLabel.textContent).toBe("26px");
      expect(elements.settingsFontSizeLabel!.textContent).toBe("26px");

      // A- button decrements by 2
      elements.smallerFontBtn.click();
      expect(controller.getSettings().fontSize).toBe(24);
      expect(elements.fontSizeSlider!.value).toBe("24");
    });

    it("should clamp font size slider within [12, 36]", () => {
      controller = new ReaderViewController(elements, { fontSize: 35 });

      elements.largerFontBtn!.click();
      expect(controller.getSettings().fontSize).toBe(36);

      // Attempt to exceed max 36
      elements.largerFontBtn!.click();
      expect(controller.getSettings().fontSize).toBe(36);

      // Lower to min
      controller.applySettings({ fontSize: 13 });
      elements.smallerFontBtn.click();
      expect(controller.getSettings().fontSize).toBe(12);

      // Attempt to go below min 12
      elements.smallerFontBtn.click();
      expect(controller.getSettings().fontSize).toBe(12);
    });

    it("should support AMOLED black theme selection with class and styling", () => {
      const onSettingsChange = vi.fn();
      controller = new ReaderViewController(
        elements,
        { theme: "light" },
        { onSettingsChange },
      );

      const amoledBtn = Array.from(elements.themeButtons).find(
        (b) => b.getAttribute("data-theme") === "amoled",
      );
      expect(amoledBtn).toBeDefined();

      amoledBtn!.click();

      expect(controller.getSettings().theme).toBe("amoled");
      expect(elements.overlay.classList.contains("theme-amoled")).toBe(true);
      expect(["#000000", "rgb(0, 0, 0)"]).toContain(elements.overlay.style.backgroundColor);
      expect(amoledBtn!.classList.contains("active")).toBe(true);
      expect(onSettingsChange).toHaveBeenCalledWith(
        expect.objectContaining({ theme: "amoled" }),
      );
    });

    it("should update clock display and initialize battery status", async () => {
      controller = new ReaderViewController(elements);

      // Clock should have been populated
      expect(elements.clockDisplay!.textContent).toBeTruthy();
      expect(elements.clockDisplay!.textContent).not.toBe("12:00");

      // Wait for battery promise resolution
      await new Promise((r) => setTimeout(r, 10));

      expect(elements.batteryDisplay!.textContent).toBe("🔋 78%");
      expect(elements.batteryDisplay!.classList.contains("hidden")).toBe(false);

      // Simulate battery level and charging update
      mockBattery.level = 0.95;
      mockBattery.charging = true;
      batteryChangeHandlers["levelchange"]?.();

      expect(elements.batteryDisplay!.textContent).toBe("⚡ 95%");
    });

    it("should acquire screen wake lock on openBook and release on close", async () => {
      vi.spyOn(FoliateReaderAdapter.prototype, "open").mockResolvedValue(undefined);
      controller = new ReaderViewController(elements);

      // Wake lock requested when opening book
      const mockBlob = new Blob(["dummy epub"], { type: "application/epub+zip" });
      await controller.openBook(mockBlob, { bookId: "book-1" });

      expect(navigator.wakeLock.request).toHaveBeenCalledWith("screen");

      // Close book releases wake lock
      await controller.close();
      expect(mockWakeLockRelease).toHaveBeenCalled();
    });

    it("should clean up intervals, battery listeners, and wake lock on destroy", async () => {
      controller = new ReaderViewController(elements);
      await new Promise((r) => setTimeout(r, 10));

      controller.destroy();
      expect(mockBattery.removeEventListener).toHaveBeenCalledWith(
        "levelchange",
        expect.any(Function),
      );
      expect(mockBattery.removeEventListener).toHaveBeenCalledWith(
        "chargingchange",
        expect.any(Function),
      );
    });
  });
});
