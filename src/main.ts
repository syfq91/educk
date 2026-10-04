import { invoke } from "@tauri-apps/api/core";
import { ReaderViewController, type ReaderViewElements } from "./features/reader/reader-view.ts";
import { DatabaseClient, createRepositories, type DatabaseRepositories } from "./services/database/index.ts";
import { TauriDownloadService } from "./services/downloads/index.ts";
import { DownloadController, type DownloadUiElements } from "./features/downloads/download-controller.ts";
import type { ReaderSettings } from "./domain/reader.ts";

let readerController: ReaderViewController | null = null;
let repos: DatabaseRepositories | null = null;

// Initialize SQLite database repositories
async function initDatabase(): Promise<DatabaseRepositories | null> {
  try {
    const client = DatabaseClient.getInstance();
    await client.getDatabase();
    repos = createRepositories(client);
    console.log("SQLite database connected successfully");
    return repos;
  } catch (err) {
    console.warn("SQLite database not available in current environment (e.g. web preview):", err);
    return null;
  }
}

// Navigation view switching
function setupNavigation(): void {
  const navButtons = document.querySelectorAll<HTMLButtonElement>(".bottom-nav .nav-item");
  const viewPanels = document.querySelectorAll<HTMLElement>(".view-panel");

  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.target;
      if (!targetId) return;

      navButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");

      viewPanels.forEach((panel) => {
        if (panel.id === targetId) {
          panel.classList.add("active");
        } else {
          panel.classList.remove("active");
        }
      });
    });
  });
}

// Production Reader View Controller Initialization
function setupReader(): void {
  const overlay = document.querySelector<HTMLElement>("#reader-view");
  const mount = document.querySelector<HTMLElement>("#reader-mount");
  const backBtn = document.querySelector<HTMLButtonElement>("#reader-btn-back");
  const title = document.querySelector<HTMLElement>("#reader-title");
  const chapter = document.querySelector<HTMLElement>("#reader-chapter");
  const progressBadge = document.querySelector<HTMLElement>("#reader-progress-badge");
  const cfiDisplay = document.querySelector<HTMLElement>("#reader-cfi");
  const tocBtn = document.querySelector<HTMLButtonElement>("#reader-btn-toc");
  const tocDrawer = document.querySelector<HTMLElement>("#reader-toc-drawer");
  const tocList = document.querySelector<HTMLElement>("#reader-toc-list");
  const tocBackdrop = document.querySelector<HTMLElement>("#reader-backdrop");
  const tocCloseBtn = document.querySelector<HTMLButtonElement>("#btn-close-toc");
  const settingsBtn = document.querySelector<HTMLButtonElement>("#reader-btn-settings");
  const settingsDrawer = document.querySelector<HTMLElement>("#reader-settings-drawer");
  const settingsCloseBtn = document.querySelector<HTMLButtonElement>("#btn-close-settings");
  const prevBtn = document.querySelector<HTMLButtonElement>("#reader-btn-prev");
  const nextBtn = document.querySelector<HTMLButtonElement>("#reader-btn-next");
  const slider = document.querySelector<HTMLInputElement>("#reader-progress-slider");
  const themeButtons = document.querySelectorAll<HTMLButtonElement>(".theme-btn");
  const fontSizeLabel = document.querySelector<HTMLElement>("#font-size-val");
  const smallerFontBtn = document.querySelector<HTMLButtonElement>("#btn-font-smaller");
  const largerFontBtn = document.querySelector<HTMLButtonElement>("#btn-font-larger");
  const fontFamilySelect = document.querySelector<HTMLSelectElement>("#select-font-family") ?? undefined;
  const lineSpacingSelect = document.querySelector<HTMLSelectElement>("#select-line-spacing") ?? undefined;
  const marginSelect = document.querySelector<HTMLSelectElement>("#select-margin") ?? undefined;
  const tapZoneLeft = document.querySelector<HTMLElement>("#tap-zone-left") ?? undefined;
  const tapZoneCenter = document.querySelector<HTMLElement>("#tap-zone-center") ?? undefined;
  const tapZoneRight = document.querySelector<HTMLElement>("#tap-zone-right") ?? undefined;

  if (
    !overlay ||
    !mount ||
    !backBtn ||
    !title ||
    !chapter ||
    !progressBadge ||
    !cfiDisplay ||
    !tocBtn ||
    !tocDrawer ||
    !tocList ||
    !tocBackdrop ||
    !tocCloseBtn ||
    !settingsBtn ||
    !settingsDrawer ||
    !settingsCloseBtn ||
    !prevBtn ||
    !nextBtn ||
    !slider ||
    !fontSizeLabel ||
    !smallerFontBtn ||
    !largerFontBtn
  ) {
    console.error("Required Reader DOM elements not found.");
    return;
  }

  const elements: ReaderViewElements = {
    overlay,
    mount,
    backBtn,
    title,
    chapter,
    progressBadge,
    cfiDisplay,
    tocBtn,
    tocDrawer,
    tocList,
    tocBackdrop,
    tocCloseBtn,
    settingsBtn,
    settingsDrawer,
    settingsCloseBtn,
    prevBtn,
    nextBtn,
    slider,
    themeButtons,
    fontSizeLabel,
    smallerFontBtn,
    largerFontBtn,
    fontFamilySelect,
    lineSpacingSelect,
    marginSelect,
    tapZoneLeft,
    tapZoneCenter,
    tapZoneRight,
  };

  readerController = new ReaderViewController(
    elements,
    {
      theme: "light",
      fontSize: 18,
      lineSpacing: 1.5,
      fontFamily: "sans-serif",
      margin: "normal",
    },
    {
      onSettingsChange: (settings) => {
        if (repos) {
          void repos.settings.setJSON("reader.settings", settings);
        }
      },
      onPositionChange: (position, bookId) => {
        if (repos && bookId) {
          void repos.progress.upsert({
            bookId,
            progression: position.progression,
            locator: position.locator,
            href: position.href ?? null,
            chapterTitle: position.title ?? null,
            modifiedAt: new Date().toISOString(),
          });
          void repos.books.updateLastOpened(bookId, new Date().toISOString());
        }
      },
    },
  );

  // Restore saved reader preferences from SQLite if available
  if (repos) {
    void repos.settings.getJSON<ReaderSettings>("reader.settings").then((savedSettings) => {
      if (savedSettings) {
        readerController?.applySettings(savedSettings);
      }
    });
  }

  // Launch EPUB 3 Sample
  const btnEpub3 = document.querySelector<HTMLButtonElement>("#btn-open-epub3");
  btnEpub3?.addEventListener("click", async () => {
    try {
      const bookId = "sample-epub3";
      if (repos) {
        const existing = await repos.books.findById(bookId);
        if (!existing) {
          await repos.books.insert({
            id: bookId,
            title: "Standard Ebooks Sample (EPUB 3)",
            acquisitionUrl: "/sample.epub",
            mimeType: "application/epub+zip",
            localPath: "/sample.epub",
            fileSize: 45000,
            downloadedAt: new Date().toISOString(),
          });
        }
      }

      const res = await fetch("/sample.epub");
      if (!res.ok) throw new Error(`HTTP ${res.status} loading /sample.epub`);
      const blob = await res.blob();

      const savedProgress = repos ? await repos.progress.findByBookId(bookId) : null;
      await readerController?.openBook(blob, {
        bookId,
        initialPosition: savedProgress?.locator,
      });
    } catch (err) {
      console.error("Failed to open EPUB 3:", err);
      alert(`Could not open EPUB 3 sample: ${String(err)}`);
    }
  });

  // Launch EPUB 2 Sample
  const btnEpub2 = document.querySelector<HTMLButtonElement>("#btn-open-epub2");
  btnEpub2?.addEventListener("click", async () => {
    try {
      const bookId = "sample-epub2";
      if (repos) {
        const existing = await repos.books.findById(bookId);
        if (!existing) {
          await repos.books.insert({
            id: bookId,
            title: "Classic Sample (EPUB 2 NCX)",
            acquisitionUrl: "/sample-epub2.epub",
            mimeType: "application/epub+zip",
            localPath: "/sample-epub2.epub",
            fileSize: 18000,
            downloadedAt: new Date().toISOString(),
          });
        }
      }

      const res = await fetch("/sample-epub2.epub");
      if (!res.ok) throw new Error(`HTTP ${res.status} loading /sample-epub2.epub`);
      const blob = await res.blob();

      const savedProgress = repos ? await repos.progress.findByBookId(bookId) : null;
      await readerController?.openBook(blob, {
        bookId,
        initialPosition: savedProgress?.locator,
      });
    } catch (err) {
      console.error("Failed to open EPUB 2:", err);
      alert(`Could not open EPUB 2 sample: ${String(err)}`);
    }
  });
}

// Milestone M5 Download Controller Setup
let downloadController: DownloadController | null = null;

function setupDownloadManager(repositories: DatabaseRepositories | null): DownloadController | null {
  const container = document.querySelector<HTMLElement>("#download-card");
  const triggerBtn = document.querySelector<HTMLButtonElement>("#btn-download-sample");
  const cancelBtn = document.querySelector<HTMLButtonElement>("#btn-cancel-download");
  const progressBar = document.querySelector<HTMLElement>("#download-progress-container");
  const progressFill = document.querySelector<HTMLElement>("#download-progress-fill");
  const statusLabel = document.querySelector<HTMLElement>("#download-status-label");
  const bytesLabel = document.querySelector<HTMLElement>("#download-bytes-label");

  if (!container || !triggerBtn || !cancelBtn || !progressBar || !progressFill || !statusLabel || !bytesLabel) {
    return null;
  }

  if (!repositories) {
    statusLabel.textContent = "Database offline (Web Preview)";
    return null;
  }

  const elements: DownloadUiElements = {
    container,
    triggerBtn,
    cancelBtn,
    progressBar,
    progressFill,
    statusLabel,
    bytesLabel,
  };

  const downloadService = new TauriDownloadService();
  downloadController = new DownloadController(elements, downloadService, repositories.books, {
    onBookAcquired: (book) => {
      console.log("Book acquired and committed:", book);
    },
    onError: (err) => {
      console.warn("Download error:", err);
    },
  });

  triggerBtn.addEventListener("click", async () => {
    try {
      const bookId = "sample-downloaded-epub";
      const sampleUrl = new URL("/sample.epub", window.location.href).href;
      await downloadController?.startDownload({
        bookId,
        url: sampleUrl,
        title: "Standard Ebooks Sample (Downloaded)",
        expectedSize: 45000,
      });
    } catch (err) {
      console.error("Failed to start download:", err);
    }
  });

  return downloadController;
}

// Backend version and status initialization
async function initApp(): Promise<void> {
  const versionBadge = document.querySelector<HTMLElement>("#app-version");
  const feVersionEl = document.querySelector<HTMLElement>("#fe-version");
  const backendStatusEl = document.querySelector<HTMLElement>("#backend-status");

  try {
    const backendVersion = await invoke<string>("get_app_version");
    if (versionBadge) {
      versionBadge.textContent = `v${backendVersion}`;
    }
    if (feVersionEl) {
      feVersionEl.textContent = backendVersion;
    }
    if (backendStatusEl) {
      backendStatusEl.textContent = "Connected (Rust Tauri 2)";
      backendStatusEl.style.color = "var(--status-success)";
    }
  } catch (err) {
    console.warn("Tauri backend not detected or command failed:", err);
    if (backendStatusEl) {
      backendStatusEl.textContent = "Web preview (IPC disconnected)";
      backendStatusEl.style.color = "var(--text-secondary)";
    }
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  setupNavigation();
  const dbRepos = await initDatabase();
  setupReader();
  setupDownloadManager(dbRepos);
  void initApp();
});
