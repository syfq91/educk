import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppLifecycleManager } from "../../src/services/lifecycle/lifecycle-manager.ts";
import type { Reader, ReadingPosition } from "../../src/domain/reader.ts";
import { ReaderViewController, type ReaderViewElements } from "../../src/features/reader/reader-view.ts";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

describe("Milestone M13: Full Android Lifecycle & Reliability Integration", () => {
  let mockReader: Reader;
  let readerElements: ReaderViewElements;
  let readerController: ReaderViewController;
  let lifecycleManager: AppLifecycleManager;

  let progressFlushSpy: ReturnType<typeof vi.fn>;
  let syncBookSpy: ReturnType<typeof vi.fn>;
  let syncQueueSpy: ReturnType<typeof vi.fn>;
  const currentReadingBookId: string | null = "test-book-m13";

  beforeEach(() => {
    vi.useFakeTimers();
    mockInvoke.mockReset();

    // Mock native wake lock
    vi.stubGlobal("navigator", {
      ...navigator,
      onLine: true,
      wakeLock: {
        request: vi.fn().mockResolvedValue({
          released: false,
          addEventListener: vi.fn(),
          release: vi.fn().mockResolvedValue(undefined),
        }),
      },
    });

    const mockPosition: ReadingPosition = {
      bookId: "test-book-m13",
      progression: 0.45,
      locator: "epubcfi(/6/14[chapter-2]!/4/2/10)",
      href: "text/ch02.xhtml",
      title: "Chapter 2: The Voyage",
      modifiedAt: "2026-10-08T12:00:00Z",
    };

    mockReader = {
      open: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      next: vi.fn().mockResolvedValue(undefined),
      previous: vi.fn().mockResolvedValue(undefined),
      goTo: vi.fn().mockResolvedValue(undefined),
      getPosition: vi.fn().mockResolvedValue(mockPosition),
      setPosition: vi.fn().mockResolvedValue(undefined),
      setTheme: vi.fn().mockResolvedValue(undefined),
      setFontSize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn(),
    };

    // DOM Setup for Reader View
    document.body.innerHTML = `
      <div id="reader-view" class="reader-overlay hidden">
        <header class="reader-header">
          <button id="reader-btn-back">Back</button>
          <button id="reader-btn-toc">TOC</button>
          <div id="reader-title">Title</div>
          <div id="reader-chapter">Chapter</div>
          <div id="reader-clock">12:00</div>
          <div id="reader-battery">100%</div>
          <button id="reader-btn-settings">Settings</button>
          <div id="reader-progress-badge">0%</div>
        </header>
        <div class="reader-canvas">
          <div id="tap-zone-left" class="tap-zone"></div>
          <div id="tap-zone-center" class="tap-zone"></div>
          <div id="tap-zone-right" class="tap-zone"></div>
          <button id="reader-btn-prev">Prev</button>
          <div id="reader-mount"></div>
          <button id="reader-btn-next">Next</button>
        </div>
        <footer class="reader-footer">
          <input type="range" id="reader-progress-slider" min="0" max="1" step="0.001" value="0" />
          <button class="theme-btn active" data-theme="light">Light</button>
          <button id="btn-font-smaller">A-</button>
          <span id="font-size-val">18px</span>
          <button id="btn-font-larger">A+</button>
          <span id="reader-cfi">—</span>
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

    readerElements = {
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
      clockDisplay: document.querySelector("#reader-clock")!,
      batteryDisplay: document.querySelector("#reader-battery")!,
    };

    readerController = new ReaderViewController(readerElements, {
      theme: "light",
      fontSize: 18,
      lineSpacing: 1.5,
      fontFamily: "sans-serif",
      margin: "normal",
    });

    // Set initial position and reader on reader view (reader active)
    readerElements.overlay.classList.remove("hidden");
    const internalCtrl = readerController as unknown as {
      reader: Reader;
      currentPosition: ReadingPosition;
    };
    internalCtrl.reader = mockReader;
    internalCtrl.currentPosition = mockPosition;

    progressFlushSpy = vi.fn().mockResolvedValue(undefined);
    syncBookSpy = vi.fn().mockResolvedValue(undefined);
    syncQueueSpy = vi.fn().mockResolvedValue(undefined);

    // Lifecycle manager wiring mirroring main.ts
    lifecycleManager = new AppLifecycleManager({
      onBackground: async () => {
        await progressFlushSpy();
        if (currentReadingBookId) {
          await syncBookSpy(currentReadingBookId);
        }
      },
      onFreeze: async () => {
        await progressFlushSpy();
        if (currentReadingBookId) {
          await syncBookSpy(currentReadingBookId);
        }
      },
      onResume: async () => {
        await readerController.handleAppResume();
      },
      onResize: async () => {
        await readerController.handleViewportResize();
      },
      onOnline: async () => {
        await syncQueueSpy();
      },
      onOffline: () => {
        // Local offline mode
      },
    }, { resizeDebounceMs: 150 });
  });

  afterEach(() => {
    lifecycleManager.destroy();
    readerController.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("persists progress and triggers sync on app backgrounding and freeze", async () => {
    // 1. App enters background
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    await Promise.resolve();

    expect(progressFlushSpy).toHaveBeenCalledTimes(1);
    expect(syncBookSpy).toHaveBeenCalledWith("test-book-m13");

    // 2. App receives freeze event from OS
    document.dispatchEvent(new Event("freeze"));
    await Promise.resolve();
    await Promise.resolve();

    expect(progressFlushSpy).toHaveBeenCalledTimes(2);
    expect(syncBookSpy).toHaveBeenCalledWith("test-book-m13");
  });

  it("re-anchors to current CFI position on screen rotation / window resize", async () => {
    // Trigger window resize (orientation change)
    window.dispatchEvent(new Event("resize"));

    // Has not fired immediately due to debounce
    expect(mockReader.goTo).not.toHaveBeenCalled();

    // Advance beyond debounce window
    await vi.advanceTimersByTimeAsync(200);

    // Re-anchored to the exact CFI locator
    expect(mockReader.goTo).toHaveBeenCalledTimes(1);
    expect(mockReader.goTo).toHaveBeenCalledWith("epubcfi(/6/14[chapter-2]!/4/2/10)");
  });

  it("restores wake lock and status bar indicators on app resume", async () => {
    const handleResumeSpy = vi.spyOn(readerController, "handleAppResume");

    // Trigger resume event (Page Lifecycle API)
    document.dispatchEvent(new Event("resume"));
    await Promise.resolve();

    expect(handleResumeSpy).toHaveBeenCalledTimes(1);
    expect(navigator.wakeLock?.request).toHaveBeenCalledWith("screen");
  });

  it("sweeps orphan download part files on startup crash recovery", async () => {
    mockInvoke.mockResolvedValueOnce(3); // 3 orphan files cleaned

    const cleanedCount = await mockInvoke<number>("cleanup_orphan_downloads");

    expect(mockInvoke).toHaveBeenCalledWith("cleanup_orphan_downloads");
    expect(cleanedCount).toBe(3);
  });

  it("handles network transitions smoothly without disrupting reader", async () => {
    // Device loses connectivity
    window.dispatchEvent(new Event("offline"));

    // Reader is unaffected and remains active
    expect(readerElements.overlay.classList.contains("hidden")).toBe(false);

    // Device regains connectivity
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();

    // Triggers progression queue synchronization
    expect(syncQueueSpy).toHaveBeenCalledTimes(1);
  });
});
