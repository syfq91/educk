import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ReaderViewController,
  type ReaderViewElements,
} from "../../src/features/reader/reader-view.ts";

describe("Milestone M3: ReaderViewController Feature Unit Tests", () => {
  let elements: ReaderViewElements;
  let controller: ReaderViewController;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="reader-view" class="reader-overlay hidden">
        <header class="reader-header">
          <button id="reader-btn-back">Back</button>
          <button id="reader-btn-toc">TOC</button>
          <div class="reader-meta">
            <div id="reader-title">Title</div>
            <div id="reader-chapter">Chapter</div>
          </div>
          <button id="reader-btn-settings">Settings</button>
          <div id="reader-progress-badge">0%</div>
        </header>

        <div class="reader-canvas">
          <div class="reader-tap-zones">
            <div id="tap-zone-left" class="tap-zone left"></div>
            <div id="tap-zone-center" class="tap-zone center"></div>
            <div id="tap-zone-right" class="tap-zone right"></div>
          </div>
          <button id="reader-btn-prev">Prev</button>
          <div id="reader-mount"></div>
          <button id="reader-btn-next">Next</button>
        </div>

        <footer class="reader-footer">
          <input type="range" id="reader-progress-slider" min="0" max="1" step="0.001" value="0" />
          <div class="reader-theme-selector">
            <button class="theme-btn active" data-theme="light">Light</button>
            <button class="theme-btn" data-theme="sepia">Sepia</button>
            <button class="theme-btn" data-theme="dark">Dark</button>
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
          <button id="btn-close-toc">Close</button>
          <ul id="reader-toc-list"></ul>
        </aside>
        <aside id="reader-settings-drawer" class="reader-drawer settings-drawer hidden">
          <button id="btn-close-settings">Close</button>
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
      largerFontBtn: document.querySelector("#btn-font-larger")!,
      tapZoneLeft: document.querySelector("#tap-zone-left")!,
      tapZoneCenter: document.querySelector("#tap-zone-center")!,
      tapZoneRight: document.querySelector("#tap-zone-right")!,
    };

    controller = new ReaderViewController(elements, {
      theme: "light",
      fontSize: 18,
      lineSpacing: 1.5,
      fontFamily: "sans-serif",
      margin: "normal",
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("should initialize with overlay hidden and default states", () => {
    expect(controller).toBeDefined();
    expect(elements.overlay.classList.contains("hidden")).toBe(true);
    expect(elements.tocDrawer.classList.contains("hidden")).toBe(true);
    expect(elements.settingsDrawer.classList.contains("hidden")).toBe(true);
  });

  it("should toggle immersive mode bars visibility", () => {
    expect(elements.overlay.classList.contains("bars-hidden")).toBe(false);

    controller.setBarsVisible(false);
    expect(elements.overlay.classList.contains("bars-hidden")).toBe(true);

    controller.setBarsVisible(true);
    expect(elements.overlay.classList.contains("bars-hidden")).toBe(false);

    controller.toggleBars();
    expect(elements.overlay.classList.contains("bars-hidden")).toBe(true);
  });

  it("should open and close TOC drawer and backdrop", () => {
    controller.openTocDrawer();
    expect(elements.tocDrawer.classList.contains("hidden")).toBe(false);
    expect(elements.tocBackdrop.classList.contains("hidden")).toBe(false);

    controller.closeTocDrawer();
    expect(elements.tocDrawer.classList.contains("hidden")).toBe(true);
    expect(elements.tocBackdrop.classList.contains("hidden")).toBe(true);
  });

  it("should open and close settings drawer", () => {
    controller.openSettingsDrawer();
    expect(elements.settingsDrawer.classList.contains("hidden")).toBe(false);

    controller.closeSettingsDrawer();
    expect(elements.settingsDrawer.classList.contains("hidden")).toBe(true);
  });

  it("should close drawers when Escape key is pressed", () => {
    elements.overlay.classList.remove("hidden");
    controller.openTocDrawer();
    controller.openSettingsDrawer();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(elements.tocDrawer.classList.contains("hidden")).toBe(true);
    expect(elements.settingsDrawer.classList.contains("hidden")).toBe(true);
  });

  it("should toggle bars when center tap zone is clicked", () => {
    expect(elements.overlay.classList.contains("bars-hidden")).toBe(false);

    elements.tapZoneCenter?.click();
    expect(elements.overlay.classList.contains("bars-hidden")).toBe(true);

    elements.tapZoneCenter?.click();
    expect(elements.overlay.classList.contains("bars-hidden")).toBe(false);
  });
});
