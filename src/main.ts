import { invoke } from "@tauri-apps/api/core";
import { ReaderViewController, type ReaderViewElements } from "./features/reader/reader-view.ts";
import { LibraryController, type LibraryUiElements } from "./features/library/library-controller.ts";
import { CatalogsController, type CatalogsUiElements } from "./features/catalogs/catalogs-controller.ts";
import { DatabaseClient, createRepositories, type DatabaseRepositories } from "./services/database/index.ts";
import { TauriDownloadService } from "./services/downloads/index.ts";
import { DownloadController, type DownloadUiElements } from "./features/downloads/download-controller.ts";
import type { ReaderSettings } from "./domain/reader.ts";
import type { Book } from "./domain/database.ts";

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
let toastDismissTimeout: ReturnType<typeof setTimeout> | null = null;

function showAcquisitionToast(book: Book): void {
  const toast = document.querySelector<HTMLElement>("#acquisition-toast");
  const titleEl = document.querySelector<HTMLElement>("#toast-title");
  const subtitleEl = document.querySelector<HTMLElement>("#toast-subtitle");
  const readBtn = document.querySelector<HTMLButtonElement>("#toast-btn-read");
  const closeBtn = document.querySelector<HTMLButtonElement>("#toast-btn-close");

  if (!toast || !titleEl || !subtitleEl || !readBtn || !closeBtn) return;

  titleEl.textContent = book.title;
  subtitleEl.textContent = book.authors ? `by ${book.authors}` : "Ready to read offline";

  readBtn.onclick = () => {
    toast.classList.add("hidden");
    if (toastDismissTimeout) clearTimeout(toastDismissTimeout);
    void libraryController?.openBook(book.id);
  };

  closeBtn.onclick = () => {
    toast.classList.add("hidden");
    if (toastDismissTimeout) clearTimeout(toastDismissTimeout);
  };

  toast.classList.remove("hidden");

  if (toastDismissTimeout) clearTimeout(toastDismissTimeout);
  toastDismissTimeout = setTimeout(() => {
    toast.classList.add("hidden");
  }, 8000);
}

function setupDownloadManager(
  repositories: DatabaseRepositories | null,
  downloadService: TauriDownloadService,
): DownloadController | null {
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

  downloadController = new DownloadController(elements, downloadService, repositories.books, {
    onBookAcquired: (book) => {
      console.log("Book acquired and committed:", book);
      void libraryController?.loadBooks?.();
      showAcquisitionToast(book);
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

// Milestone M6 Library Controller Setup
let libraryController: LibraryController | null = null;

function setupLibrary(
  repositories: DatabaseRepositories | null,
  readerCtrl: ReaderViewController | null,
  readerEl: ReaderViewElements | null,
): LibraryController | null {
  const container = document.querySelector<HTMLElement>("#view-library");
  const list = document.querySelector<HTMLElement>("#library-list");
  const emptyState = document.querySelector<HTMLElement>("#library-empty");
  const sortSelect = document.querySelector<HTMLSelectElement>("#library-sort");
  const refreshBtn = document.querySelector<HTMLButtonElement>("#library-refresh");

  if (!container || !list || !emptyState || !sortSelect || !refreshBtn) {
    console.error("Required Library DOM elements not found.");
    return null;
  }

  if (!repositories) {
    emptyState.classList.remove("hidden");
    emptyState.querySelector("h2")!.textContent = "Database Unavailable";
    emptyState.querySelector("p")!.textContent = "SQLite not available in this environment.";
    list.classList.add("hidden");
    return null;
  }

  const elements: LibraryUiElements = {
    container,
    list,
    emptyState,
    sortSelect,
    refreshBtn,
  };

  libraryController = new LibraryController(
    elements,
    repositories.books,
    repositories.progress,
    readerCtrl,
    readerEl,
    {
      onOpenBook: (bookId) => {
        console.log("Opened book from library:", bookId);
      },
      onError: (err) => {
        console.error("Library error:", err);
      },
    },
  );

  return libraryController;
}

// Milestone M7 Catalogs Controller Setup
let catalogsController: CatalogsController | null = null;

function setupCatalogs(
  repositories: DatabaseRepositories | null,
  downloadService: TauriDownloadService,
): CatalogsController | null {
  const container = document.querySelector<HTMLElement>("#view-catalogs");
  const catalogList = document.querySelector<HTMLElement>("#catalog-list");
  const feedView = document.querySelector<HTMLElement>("#feed-view");
  const feedTitle = document.querySelector<HTMLElement>("#feed-title");
  const feedBreadcrumb = document.querySelector<HTMLElement>("#feed-breadcrumb");
  const feedList = document.querySelector<HTMLElement>("#feed-list");
  const feedEmpty = document.querySelector<HTMLElement>("#feed-empty");
  const feedLoading = document.querySelector<HTMLElement>("#feed-loading");
  const feedError = document.querySelector<HTMLElement>("#feed-error");
  const addCatalogBtn = document.querySelector<HTMLButtonElement>("#btn-add-catalog");
  const addCatalogModal = document.querySelector<HTMLElement>("#add-catalog-modal");
  const addCatalogForm = document.querySelector<HTMLFormElement>("#add-catalog-form");
  const searchInput = document.querySelector<HTMLInputElement>("#feed-search-input");
  const searchBtn = document.querySelector<HTMLButtonElement>("#feed-search-btn");
  const paginationPrev = document.querySelector<HTMLButtonElement>("#feed-prev");
  const paginationNext = document.querySelector<HTMLButtonElement>("#feed-next");
  const paginationInfo = document.querySelector<HTMLElement>("#feed-page-info");

  if (
    !container ||
    !catalogList ||
    !feedView ||
    !feedTitle ||
    !feedBreadcrumb ||
    !feedList ||
    !feedEmpty ||
    !feedLoading ||
    !feedError ||
    !addCatalogBtn ||
    !addCatalogModal ||
    !addCatalogForm ||
    !searchInput ||
    !searchBtn ||
    !paginationPrev ||
    !paginationNext ||
    !paginationInfo
  ) {
    console.error("Required Catalogs DOM elements not found.");
    return null;
  }

  if (!repositories) {
    catalogList.innerHTML = `
      <div class="error-state">
        <p>Database unavailable. Cannot manage catalogs.</p>
      </div>
    `;
    return null;
  }

  // Milestone M8 Enhanced Elements
  const exportOpmlBtn = document.querySelector<HTMLButtonElement>("#btn-export-opml");
  const importOpmlBtn = document.querySelector<HTMLButtonElement>("#btn-import-opml");
  const opmlFileInput = document.querySelector<HTMLInputElement>("#opml-file-input");
  const viewGridBtn = document.querySelector<HTMLButtonElement>("#btn-view-grid");
  const viewListBtn = document.querySelector<HTMLButtonElement>("#btn-view-list");
  const facetsContainer = document.querySelector<HTMLElement>("#feed-facets");
  const searchSuggestions = document.querySelector<HTMLElement>("#feed-search-suggestions");
  const scrollSentinel = document.querySelector<HTMLElement>("#feed-scroll-sentinel");
  const emptyBackBtn = document.querySelector<HTMLButtonElement>("#btn-feed-empty-back");
  const authModal = document.querySelector<HTMLElement>("#feed-auth-modal");
  const authForm = document.querySelector<HTMLFormElement>("#feed-auth-form");
  const authMessage = document.querySelector<HTMLElement>("#feed-auth-message");

  const elements: CatalogsUiElements = {
    container,
    catalogList,
    feedView,
    feedTitle,
    feedBreadcrumb,
    feedList,
    feedEmpty,
    feedLoading,
    feedError,
    addCatalogBtn,
    addCatalogModal,
    addCatalogForm,
    searchInput,
    searchBtn,
    paginationPrev,
    paginationNext,
    paginationInfo,
    exportOpmlBtn,
    importOpmlBtn,
    opmlFileInput,
    viewGridBtn,
    viewListBtn,
    facetsContainer,
    searchSuggestions,
    scrollSentinel,
    emptyBackBtn,
    authModal,
    authForm,
    authMessage,
  };

  catalogsController = new CatalogsController(
    elements,
    downloadService,
    repositories.books,
    repositories.sources,
    {
      onDownloadStarted: (bookId) => {
        console.log("Download started from catalog:", bookId);
      },
      onBookAcquired: (book) => {
        console.log("Book acquired from catalog:", book);
        void libraryController?.loadBooks?.();
        showAcquisitionToast(book);
      },
      onReadNow: (bookId) => {
        console.log("Opening book from catalog:", bookId);
        void libraryController?.openBook(bookId);
      },
      onError: (err) => {
        console.error("Catalogs error:", err);
      },
    },
  );

  return catalogsController;
}

window.addEventListener("DOMContentLoaded", async () => {
  setupNavigation();
  const dbRepos = await initDatabase();
  setupReader();
  const downloadService = new TauriDownloadService();
  setupDownloadManager(dbRepos, downloadService);
  setupLibrary(dbRepos, readerController, {
    overlay: document.querySelector<HTMLElement>("#reader-view")!,
    mount: document.querySelector<HTMLElement>("#reader-mount")!,
    backBtn: document.querySelector<HTMLButtonElement>("#reader-btn-back")!,
    title: document.querySelector<HTMLElement>("#reader-title")!,
    chapter: document.querySelector<HTMLElement>("#reader-chapter")!,
    progressBadge: document.querySelector<HTMLElement>("#reader-progress-badge")!,
    cfiDisplay: document.querySelector<HTMLElement>("#reader-cfi")!,
    tocBtn: document.querySelector<HTMLButtonElement>("#reader-btn-toc")!,
    tocDrawer: document.querySelector<HTMLElement>("#reader-toc-drawer")!,
    tocList: document.querySelector<HTMLElement>("#reader-toc-list")!,
    tocBackdrop: document.querySelector<HTMLElement>("#reader-backdrop")!,
    tocCloseBtn: document.querySelector<HTMLButtonElement>("#btn-close-toc")!,
    settingsBtn: document.querySelector<HTMLButtonElement>("#reader-btn-settings")!,
    settingsDrawer: document.querySelector<HTMLElement>("#reader-settings-drawer")!,
    settingsCloseBtn: document.querySelector<HTMLButtonElement>("#btn-close-settings")!,
    prevBtn: document.querySelector<HTMLButtonElement>("#reader-btn-prev")!,
    nextBtn: document.querySelector<HTMLButtonElement>("#reader-btn-next")!,
    slider: document.querySelector<HTMLInputElement>("#reader-progress-slider")!,
    themeButtons: document.querySelectorAll<HTMLButtonElement>(".theme-btn"),
    fontSizeLabel: document.querySelector<HTMLElement>("#font-size-val")!,
    smallerFontBtn: document.querySelector<HTMLButtonElement>("#btn-font-smaller")!,
    largerFontBtn: document.querySelector<HTMLButtonElement>("#btn-font-larger")!,
    fontFamilySelect: document.querySelector<HTMLSelectElement>("#select-font-family") ?? undefined,
    lineSpacingSelect: document.querySelector<HTMLSelectElement>("#select-line-spacing") ?? undefined,
    marginSelect: document.querySelector<HTMLSelectElement>("#select-margin") ?? undefined,
    tapZoneLeft: document.querySelector<HTMLElement>("#tap-zone-left") ?? undefined,
    tapZoneCenter: document.querySelector<HTMLElement>("#tap-zone-center") ?? undefined,
    tapZoneRight: document.querySelector<HTMLElement>("#tap-zone-right") ?? undefined,
  });
  setupCatalogs(dbRepos, downloadService);
  void initApp();
});
