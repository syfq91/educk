import { invoke } from "@tauri-apps/api/core";
import { ReaderViewController, type ReaderViewElements } from "./features/reader/reader-view.ts";
import { LibraryController, type LibraryUiElements } from "./features/library/library-controller.ts";
import { CatalogsController, type CatalogsUiElements } from "./features/catalogs/catalogs-controller.ts";
import { DatabaseClient, createRepositories, type DatabaseRepositories } from "./services/database/index.ts";
import { TauriDownloadService } from "./services/downloads/index.ts";
import { LocalProgressManager } from "./services/progress/index.ts";
import {
  createProgressionClient,
  createProgressionSyncManager,
  type ProgressionSyncManager,
  type ProgressionConflict,
} from "./services/progression/index.ts";
import { AppLifecycleManager } from "./services/lifecycle/lifecycle-manager.ts";
import { AppProfiler } from "./services/performance/profiler.ts";
import { PaperSettingController, getPaper } from "./features/settings/paper.ts";
import type { ReaderSettings, ReaderFontFamily } from "./domain/reader.ts";
import type { Book } from "./domain/database.ts";

let readerController: ReaderViewController | null = null;
let paperController: PaperSettingController | null = null;
let repos: DatabaseRepositories | null = null;
let progressionSyncManager: ProgressionSyncManager | null = null;
let currentReadingBookId: string | null = null;

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

  // The library empty state's single call to action opens the catalog view.
  document.querySelector<HTMLButtonElement>("#btn-empty-browse")?.addEventListener("click", () => {
    document.querySelector<HTMLButtonElement>('.bottom-nav .nav-item[data-target="view-catalogs"]')?.click();
  });
}

// Progression Conflict Prompt Banner (Milestone M11)
function setupConflictBanner(syncManager: ProgressionSyncManager): void {
  const banner = document.querySelector<HTMLElement>("#reader-conflict-banner");
  const descEl = document.querySelector<HTMLElement>("#conflict-desc");
  const applyBtn = document.querySelector<HTMLButtonElement>("#btn-conflict-apply-remote");
  const keepBtn = document.querySelector<HTMLButtonElement>("#btn-conflict-keep-local");

  if (!banner || !descEl || !applyBtn || !keepBtn) return;

  applyBtn.onclick = async () => {
    if (!currentReadingBookId) return;
    const targetBookId = currentReadingBookId;
    banner.classList.add("hidden");
    const result = await syncManager.resolveConflict(targetBookId, "apply_remote");
    if (result.action === "pulled" && repos && currentReadingBookId === targetBookId) {
      const updated = await repos.progress.findByBookId(targetBookId);
      if (updated?.locator) {
        await readerController?.goTo(updated.locator);
      }
    }
  };

  keepBtn.onclick = async () => {
    if (!currentReadingBookId) return;
    const targetBookId = currentReadingBookId;
    banner.classList.add("hidden");
    await syncManager.resolveConflict(targetBookId, "keep_local");
  };
}

function showConflictBanner(conflict: ProgressionConflict): void {
  const banner = document.querySelector<HTMLElement>("#reader-conflict-banner");
  const descEl = document.querySelector<HTMLElement>("#conflict-desc");
  if (!banner || !descEl) return;

  const pct = Math.round(conflict.remoteProgression * 100);
  descEl.textContent = `Newer reading progress found from another device (${pct}%).`;
  banner.classList.remove("hidden");
}

// Helper to collect Reader UI elements from the DOM
function getReaderElements(): ReaderViewElements | null {
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
  const clockDisplay = document.querySelector<HTMLElement>("#reader-clock") ?? undefined;
  const batteryDisplay = document.querySelector<HTMLElement>("#reader-battery") ?? undefined;
  const fontSizeSlider = document.querySelector<HTMLInputElement>("#slider-font-size") ?? undefined;
  const settingsFontSizeLabel = document.querySelector<HTMLElement>("#settings-font-size-label") ?? undefined;

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
    return null;
  }

  return {
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
    clockDisplay,
    batteryDisplay,
    fontSizeSlider,
    settingsFontSizeLabel,
  };
}

// Synchronize global Settings tab UI inputs with reader settings
function syncSettingsView(settings: ReaderSettings): void {
  const fontSelect = document.querySelector<HTMLSelectElement>("#pref-font-family");
  const fontSizeInput = document.querySelector<HTMLInputElement>("#pref-font-size");
  const fontSizeVal = document.querySelector<HTMLElement>("#pref-font-size-val");
  const lineSpacingSelect = document.querySelector<HTMLSelectElement>("#pref-line-spacing");
  const marginSelect = document.querySelector<HTMLSelectElement>("#pref-margin");

  if (fontSelect) fontSelect.value = settings.fontFamily;
  if (fontSizeInput) fontSizeInput.value = String(settings.fontSize);
  if (fontSizeVal) fontSizeVal.textContent = `${settings.fontSize}px`;
  if (lineSpacingSelect) lineSpacingSelect.value = String(settings.lineSpacing);
  if (marginSelect) marginSelect.value = settings.margin;
}

// Setup Settings Tab reader preference controls
function setupSettingsView(
  repositories: DatabaseRepositories | null,
  readerCtrl: ReaderViewController | null,
): void {
  const fontSelect = document.querySelector<HTMLSelectElement>("#pref-font-family");
  const fontSizeInput = document.querySelector<HTMLInputElement>("#pref-font-size");
  const fontSizeVal = document.querySelector<HTMLElement>("#pref-font-size-val");
  const lineSpacingSelect = document.querySelector<HTMLSelectElement>("#pref-line-spacing");
  const marginSelect = document.querySelector<HTMLSelectElement>("#pref-margin");

  const saveAndApply = () => {
    const current = readerCtrl?.getSettings() ?? {
      theme: "white" as const,
      fontSize: 18,
      lineSpacing: 1.5,
      fontFamily: "sans-serif" as const,
      margin: "normal" as const,
    };

    const newSettings: ReaderSettings = {
      theme: current.theme, // the paper is owned by the Appearance switch
      fontFamily: (fontSelect?.value as ReaderFontFamily) || current.fontFamily,
      fontSize: fontSizeInput ? parseInt(fontSizeInput.value, 10) || current.fontSize : current.fontSize,
      lineSpacing: lineSpacingSelect ? parseFloat(lineSpacingSelect.value) || current.lineSpacing : current.lineSpacing,
      margin: (marginSelect?.value as "narrow" | "normal" | "wide") || current.margin,
    };

    readerCtrl?.applySettings(newSettings);
    if (repositories) {
      void repositories.settings.setJSON("reader.settings", newSettings);
    }
  };

  fontSelect?.addEventListener("change", saveAndApply);
  lineSpacingSelect?.addEventListener("change", saveAndApply);
  marginSelect?.addEventListener("change", saveAndApply);

  fontSizeInput?.addEventListener("input", () => {
    if (fontSizeVal) {
      fontSizeVal.textContent = `${fontSizeInput.value}px`;
    }
    saveAndApply();
  });
}

// Production Reader View Controller Initialization
function setupReader(
  progressManager: LocalProgressManager | null,
  syncManager: ProgressionSyncManager | null = null,
): void {
  const elements = getReaderElements();
  if (!elements) {
    console.error("Required Reader DOM elements not found.");
    return;
  }

  readerController = new ReaderViewController(
    elements,
    {
      theme: getPaper(),
      fontSize: 18,
      lineSpacing: 1.5,
      fontFamily: "sans-serif",
      margin: "normal",
    },
    {
      onSettingsChange: (settings) => {
        // Keep the Settings appearance switch in step with the reader.
        paperController?.sync(settings.theme);
        if (repos) {
          void repos.settings.setJSON("reader.settings", settings);
        }
        syncSettingsView(settings);
      },
      onPositionChange: (position, bookId) => {
        if (bookId) {
          progressManager?.recordProgress({
            bookId,
            progression: position.progression,
            locator: position.locator,
            href: position.href ?? null,
            chapterTitle: position.title ?? null,
            modifiedAt: position.modifiedAt || new Date().toISOString(),
          });
        }
      },
      onBeforeClose: async () => {
        if (progressManager) {
          await progressManager.flush();
        }
      },
      onClose: () => {
        const closingBookId = currentReadingBookId;
        currentReadingBookId = null;
        document.querySelector("#reader-conflict-banner")?.classList.add("hidden");
        if (closingBookId && syncManager) {
          void syncManager.syncBook(closingBookId);
        }
        void libraryController?.loadBooks?.();
      },
    },
  );

  // Restore saved reader preferences from SQLite if available.
  // The paper background is deliberately excluded: it is owned by the
  // appearance preference (localStorage) so the app chrome and the reader can
  // never disagree about which of the two DESIGN.md backgrounds is active.
  if (repos) {
    void repos.settings.getJSON<Partial<ReaderSettings>>("reader.settings").then((savedSettings) => {
      if (savedSettings) {
        // The paper background is owned by the appearance preference
        // (localStorage), so the app chrome and the reader can never disagree
        // about which of the two DESIGN.md backgrounds is active.
        readerController?.applySettings({ ...savedSettings, theme: getPaper() });
        if (readerController) {
          syncSettingsView(readerController.getSettings());
        }
      }
    });
  }

}

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
      backendStatusEl.style.color = "var(--color-primary)";
    }

    // Milestone M13: Clean up any orphan .part download files from previous crashes
    try {
      const cleaned = await invoke<number>("cleanup_orphan_downloads");
      if (cleaned > 0) {
        console.log(`Cleaned up ${cleaned} orphan download part file(s) on startup`);
      }
    } catch (cleanupErr) {
      console.warn("Orphan download cleanup skipped or failed:", cleanupErr);
    }
  } catch (err) {
    console.warn("Tauri backend not detected or command failed:", err);
    if (backendStatusEl) {
      backendStatusEl.textContent = "Web preview (IPC disconnected)";
      backendStatusEl.style.color = "var(--color-secondary)";
    }
  }
}

// Milestone M6 Library Controller Setup
let libraryController: LibraryController | null = null;

function setupLibrary(
  repositories: DatabaseRepositories | null,
  readerCtrl: ReaderViewController | null,
  readerEl: ReaderViewElements | null,
  downloadService: TauriDownloadService,
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

  const recoveryModal = document.querySelector<HTMLElement>("#book-recovery-modal");
  const recoveryTitle = document.querySelector<HTMLElement>("#recovery-title");
  const recoveryMessage = document.querySelector<HTMLElement>("#recovery-message");
  const recoveryErrorDetail = document.querySelector<HTMLElement>("#recovery-error-detail");
  const btnRecoveryRedownload = document.querySelector<HTMLButtonElement>("#btn-recovery-redownload");
  const btnRecoveryDelete = document.querySelector<HTMLButtonElement>("#btn-recovery-delete");
  const btnRecoveryDismiss = document.querySelector<HTMLButtonElement>("#btn-recovery-dismiss");

  const elements: LibraryUiElements = {
    container,
    list,
    emptyState,
    sortSelect,
    refreshBtn,
    recoveryModal,
    recoveryTitle,
    recoveryMessage,
    recoveryErrorDetail,
    btnRecoveryRedownload,
    btnRecoveryDelete,
    btnRecoveryDismiss,
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
        currentReadingBookId = bookId;
        if (progressionSyncManager) {
          void progressionSyncManager.syncBook(bookId, { isColdOpen: true }).then(async (res) => {
            if (res.action === "pulled" && repos && currentReadingBookId === bookId) {
              const updated = await repos.progress.findByBookId(bookId);
              if (updated?.locator) {
                await readerController?.goTo(updated.locator);
              }
            }
          });
        }
      },
      onError: (err) => {
        console.error("Library error:", err);
      },
      onRedownloadBook: async (book) => {
        if (book.acquisitionUrl && repositories) {
          console.log("Re-downloading book from acquisition URL:", book.acquisitionUrl);
          try {
            let headers: Record<string, string> | undefined;
            if (book.sourceId) {
              const source = await repositories.sources.findById(book.sourceId);
              if (source) {
                if (source.authType === "basic" && source.username && source.authData) {
                  headers = { Authorization: `Basic ${btoa(`${source.username}:${source.authData}`)}` };
                } else if (source.authType === "bearer" && source.authData) {
                  headers = { Authorization: `Bearer ${source.authData}` };
                }
              }
            }

            const result = await downloadService.downloadBook({
              bookId: book.id,
              url: book.acquisitionUrl,
              title: book.title,
              authors: book.authors ?? undefined,
              coverUrl: book.coverUrl ?? undefined,
              headers,
            });
            await repositories.books.update({
              ...book,
              localPath: result.localPath,
              fileSize: result.fileSize,
              downloadedAt: new Date().toISOString(),
            });
            void libraryController?.loadBooks?.();
            showAcquisitionToast(book);
          } catch (dlErr) {
            console.error("Failed to re-download book:", dlErr);
          }
        }
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
  const feedBackBtn = document.querySelector<HTMLButtonElement>("#btn-feed-back");
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
    feedBackBtn,
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
      onProgressionDiscovered: (bookId, progressionUrl) => {
        if (progressionSyncManager) {
          void progressionSyncManager.registerProgressionUrl(bookId, progressionUrl);
        }
      },
      onError: (err) => {
        console.error("Catalogs error:", err);
      },
    },
  );

  return catalogsController;
}

// Appearance: the user-selectable paper background (DESIGN.md: two
// backgrounds only — white and warm paper white). The same preference drives
// the reader, so the Settings switch and the in-reader switch stay in sync.
function setupAppearance(): void {
  const paperButtons = document.querySelectorAll<HTMLButtonElement>(".paper-toggle .btn-paper");
  if (paperButtons.length === 0) return;
  paperController = new PaperSettingController(paperButtons, (paper) => {
    readerController?.applySettings({ theme: paper });
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  const profiler = AppProfiler.getInstance();
  profiler.markColdStart();

  setupNavigation();
  setupAppearance();
  const dbRepos = await initDatabase();
  profiler.markDatabaseReady();

  const progressionClient = createProgressionClient();
  if (dbRepos) {
    progressionSyncManager = createProgressionSyncManager({
      progressRepo: dbRepos.progress,
      syncStateRepo: dbRepos.syncState,
      settingsRepo: dbRepos.settings,
      bookRepo: dbRepos.books,
      sourceRepo: dbRepos.sources,
      client: progressionClient,
      callbacks: {
        onConflictPrompt: (conflict) => {
          showConflictBanner(conflict);
        },
      },
    });
    setupConflictBanner(progressionSyncManager);
  }

  const progressManager = dbRepos
    ? new LocalProgressManager(dbRepos.progress, dbRepos.books, {
        debounceMs: 1000,
        onProgressSaved: (update) => {
          if (progressionSyncManager) {
            void progressionSyncManager.syncBook(update.bookId, { isSessionActive: true });
          }
        },
      })
    : null;
  setupReader(progressManager, progressionSyncManager);
  const downloadService = new TauriDownloadService();
  setupLibrary(dbRepos, readerController, getReaderElements(), downloadService);
  profiler.markLibraryReady();

  setupCatalogs(dbRepos, downloadService);
  setupSettingsView(dbRepos, readerController);

  const startupMetrics = profiler.measureStartup();
  console.log(
    `[Perf] Cold startup: ${Math.round(startupMetrics.totalColdStartMs)}ms (DB: ${Math.round(startupMetrics.dbInitMs)}ms, Library: ${Math.round(startupMetrics.libraryRenderMs)}ms)`,
  );

  // Milestone M13 App Lifecycle Manager
  new AppLifecycleManager({
    onBackground: async () => {
      console.log("App entering background / pagehide: flushing progress and sync");
      await progressManager?.flush();
      if (currentReadingBookId && progressionSyncManager) {
        await progressionSyncManager.syncBook(currentReadingBookId);
      }
    },
    onFreeze: async () => {
      console.log("App freezing: flushing progress and sync");
      await progressManager?.flush();
      if (currentReadingBookId && progressionSyncManager) {
        await progressionSyncManager.syncBook(currentReadingBookId);
      }
    },
    onResume: async () => {
      console.log("App resumed to foreground");
      await readerController?.handleAppResume();
    },
    onResize: async () => {
      console.log("App window resized / orientation changed");
      await readerController?.handleViewportResize();
    },
    onOnline: async () => {
      console.log("Network online: triggering progression sync queue");
      if (progressionSyncManager) {
        await progressionSyncManager.syncQueue();
      }
    },
    onOffline: () => {
      console.log("Network offline: running in offline-first mode");
    },
  });

  void initApp();
});
