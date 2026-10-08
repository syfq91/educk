import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMigratedTestDatabase, type NodeSqliteDatabase } from "../helpers/test-database.js";
import { SqlSettingsRepository } from "../../src/services/database/sql-settings-repository.js";
import {
  ReaderViewController,
  type ReaderViewElements,
} from "../../src/features/reader/reader-view.ts";
import { FoliateReaderAdapter } from "../../src/services/reader/foliate-adapter.ts";
import type { ReaderSettings } from "../../src/domain/reader.ts";

describe("Milestone M12: Reader UX & Settings Integration Tests", () => {
  let db: NodeSqliteDatabase;
  let settingsRepo: SqlSettingsRepository;
  let elements: ReaderViewElements;
  let controller: ReaderViewController;

  beforeEach(() => {
    // Reset and initialize in-memory SQLite database
    db = createMigratedTestDatabase();
    settingsRepo = new SqlSettingsRepository(db);
    vi.spyOn(FoliateReaderAdapter.prototype, "open").mockResolvedValue(undefined);

    // Mock Battery and WakeLock APIs
    Object.defineProperty(navigator, "getBattery", {
      value: vi.fn().mockResolvedValue({
        level: 0.9,
        charging: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
      configurable: true,
    });

    Object.defineProperty(navigator, "wakeLock", {
      value: {
        request: vi.fn().mockResolvedValue({
          release: vi.fn().mockResolvedValue(undefined),
        }),
      },
      configurable: true,
    });

    // Populate Reader and Settings DOM elements
    document.body.innerHTML = `
      <section id="view-settings">
        <select id="pref-theme">
          <option value="light">Light</option>
          <option value="sepia">Sepia</option>
          <option value="dark">Dark</option>
          <option value="amoled">Black</option>
        </select>
        <select id="pref-font-family">
          <option value="sans-serif">Sans-Serif</option>
          <option value="serif">Serif</option>
          <option value="monospace">Monospace</option>
          <option value="opendyslexic">OpenDyslexic</option>
        </select>
        <input type="range" id="pref-font-size" min="12" max="36" value="18" />
        <span id="pref-font-size-val">18px</span>
        <select id="pref-line-spacing">
          <option value="1.2">1.2</option>
          <option value="1.5">1.5</option>
          <option value="1.8">1.8</option>
        </select>
        <select id="pref-margin">
          <option value="narrow">Narrow</option>
          <option value="normal">Normal</option>
          <option value="wide">Wide</option>
        </select>
      </section>

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
          <div id="tap-zone-left" class="tap-zone left"></div>
          <div id="tap-zone-center" class="tap-zone center"></div>
          <div id="tap-zone-right" class="tap-zone right"></div>
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

  afterEach(async () => {
    controller?.destroy();
    await db.close();
    document.body.innerHTML = "";
  });

  it("should persist reader settings changes to SQLite repository in real-time", async () => {
    controller = new ReaderViewController(
      elements,
      {
        theme: "light",
        fontSize: 18,
        fontFamily: "sans-serif",
        lineSpacing: 1.5,
        margin: "normal",
      },
      {
        onSettingsChange: (settings) => {
          void settingsRepo.setJSON("reader.settings", settings);
        },
      },
    );

    // 1. Change font size to 24 via slider
    elements.fontSizeSlider!.value = "24";
    elements.fontSizeSlider!.dispatchEvent(new Event("input"));

    // 2. Change font family to OpenDyslexic
    elements.fontFamilySelect!.value = "opendyslexic";
    elements.fontFamilySelect!.dispatchEvent(new Event("change"));

    // 3. Change theme to AMOLED
    const amoledBtn = Array.from(elements.themeButtons).find(
      (b) => b.getAttribute("data-theme") === "amoled",
    )!;
    amoledBtn.click();

    // 4. Change line spacing to 1.8
    elements.lineSpacingSelect!.value = "1.8";
    elements.lineSpacingSelect!.dispatchEvent(new Event("change"));

    // 5. Change margins to wide
    elements.marginSelect!.value = "wide";
    elements.marginSelect!.dispatchEvent(new Event("change"));

    // Verify persisted record in SQLite
    const saved = await settingsRepo.getJSON<ReaderSettings>("reader.settings");
    expect(saved).toBeDefined();
    expect(saved).toEqual({
      theme: "amoled",
      fontSize: 24,
      fontFamily: "opendyslexic",
      lineSpacing: 1.8,
      margin: "wide",
    });
  });

  it("should restore saved settings on fresh app launch and correctly style UI", async () => {
    // Seed SQLite database with pre-existing user preferences
    const preSaved: ReaderSettings = {
      theme: "amoled",
      fontSize: 22,
      fontFamily: "opendyslexic",
      lineSpacing: 1.8,
      margin: "wide",
    };
    await settingsRepo.setJSON("reader.settings", preSaved);

    // Retrieve from database
    const loadedSettings = await settingsRepo.getJSON<ReaderSettings>("reader.settings");
    expect(loadedSettings).toEqual(preSaved);

    // Initialize controller with loaded settings
    controller = new ReaderViewController(elements, loadedSettings!);

    // Verify Reader UI reflection
    expect(controller.getSettings().theme).toBe("amoled");
    expect(controller.getSettings().fontSize).toBe(22);
    expect(controller.getSettings().fontFamily).toBe("opendyslexic");
    expect(controller.getSettings().lineSpacing).toBe(1.8);
    expect(controller.getSettings().margin).toBe("wide");

    expect(elements.overlay.classList.contains("theme-amoled")).toBe(true);
    expect(elements.fontSizeLabel.textContent).toBe("22px");
    expect(elements.settingsFontSizeLabel!.textContent).toBe("22px");
    expect(elements.fontSizeSlider!.value).toBe("22");
    expect(elements.fontFamilySelect!.value).toBe("opendyslexic");
    expect(elements.lineSpacingSelect!.value).toBe("1.8");
    expect(elements.marginSelect!.value).toBe("wide");
  });
});
