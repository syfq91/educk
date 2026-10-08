/**
 * CatalogsController
 *
 * Manages the OPDS Catalogs view:
 * - Displays configured OPDS catalogs from SQLite (SourceRepository)
 * - Feed browsing & navigation (breadcrumbs, search, pagination, infinite scroll)
 * - Grid vs. List view toggle with persistent preference
 * - Facet filtering chips (genres, authors, sort options)
 * - Search suggestions & recent searches dropdown
 * - Catalog import/export via OPML
 * - Loading skeletons, network error retry, and 401/403 auth prompts
 * - Initiates downloads via DownloadService
 */

import { OPDSClient, createOPDSClient } from "../../services/opds/index.ts";
import { OPDSAuthError } from "../../domain/opds.ts";
import type {
  OPDSFeed,
  OPDSEntry,
  OPDSCatalog,
  OPDSCatalogAuth,
  OPDSNavigationState,
  OPDSFacet,
  AcquisitionLink,
} from "../../domain/opds.ts";
import type { DownloadProgress, DownloadService } from "../../domain/downloads.ts";
import type { Book, BookRepository, SourceRepository, CatalogSource, AuthType } from "../../domain/database.ts";
import { exportCatalogsToOPML, parseOPML } from "./opml.ts";

export interface CatalogsUiElements {
  container: HTMLElement;
  catalogList: HTMLElement;
  feedView: HTMLElement;
  feedTitle: HTMLElement;
  feedBreadcrumb: HTMLElement;
  feedList: HTMLElement;
  feedEmpty: HTMLElement;
  feedLoading: HTMLElement;
  feedError: HTMLElement;
  addCatalogBtn: HTMLButtonElement;
  addCatalogModal: HTMLElement;
  addCatalogForm: HTMLFormElement;
  searchInput: HTMLInputElement;
  searchBtn: HTMLButtonElement;
  paginationPrev: HTMLButtonElement;
  paginationNext: HTMLButtonElement;
  paginationInfo: HTMLElement;

  // Milestone M8 Enhanced Elements
  exportOpmlBtn?: HTMLButtonElement | null;
  importOpmlBtn?: HTMLButtonElement | null;
  opmlFileInput?: HTMLInputElement | null;
  viewGridBtn?: HTMLButtonElement | null;
  viewListBtn?: HTMLButtonElement | null;
  facetsContainer?: HTMLElement | null;
  searchSuggestions?: HTMLElement | null;
  scrollSentinel?: HTMLElement | null;
  emptyBackBtn?: HTMLButtonElement | null;
  authModal?: HTMLElement | null;
  authForm?: HTMLFormElement | null;
  authMessage?: HTMLElement | null;
}

export interface CatalogsControllerCallbacks {
  onDownloadStarted?: (bookId: string) => void;
  onDownloadCompleted?: (book: Book) => void;
  onBookAcquired?: (book: Book) => void;
  onProgressionDiscovered?: (bookId: string, progressionUrl: string) => void;
  onReadNow?: (bookId: string) => void;
  onError?: (error: Error) => void;
  onCatalogsChanged?: (catalogs: OPDSCatalog[]) => void;
}

const DEFAULT_CATALOGS: Array<{ id: string; name: string; url: string; description: string }> = [
  {
    id: "standardebooks",
    name: "Standard Ebooks",
    url: "https://standardebooks.org/opds",
    description: "Free public domain ebooks, beautifully formatted",
  },
  {
    id: "gutenberg",
    name: "Project Gutenberg",
    url: "https://www.gutenberg.org/opds/catalog.rdf",
    description: "Over 60,000 free ebooks",
  },
  {
    id: "feedbooks",
    name: "Feedbooks",
    url: "https://www.feedbooks.com/opds",
    description: "Public domain and original books",
  },
];

const SEARCH_SUGGESTION_TOPICS = [
  "Fiction",
  "Philosophy",
  "Science Fiction",
  "History",
  "Classics",
  "Poetry",
  "Mystery",
  "Adventure",
];

export class CatalogsController {
  private elements: CatalogsUiElements;
  private opdsClient: OPDSClient;
  private downloadService: DownloadService;
  private bookRepo: BookRepository;
  private sourceRepo: SourceRepository;
  private callbacks: CatalogsControllerCallbacks;

  private catalogs: OPDSCatalog[] = [];
  private navigationState: OPDSNavigationState | null = null;
  private abortController: AbortController | null = null;
  private viewMode: "grid" | "list" = "grid";
  private isLoadingNextPage = false;
  private intersectionObserver: IntersectionObserver | null = null;
  private allFeedEntries: OPDSEntry[] = [];
  private activeFacetFilters: Map<string, string> = new Map();
  private lastFailedUrl: string | null = null;
  private downloadedBookIds: Set<string> = new Set();
  private downloadedRemoteIds: Set<string> = new Set();
  private activeDownloads: Map<string, DownloadProgress> = new Map();
  private unsubscribeDownloadProgress: (() => void) | null = null;

  constructor(
    elements: CatalogsUiElements,
    downloadService: DownloadService,
    bookRepo: BookRepository,
    sourceRepo?: SourceRepository | CatalogsControllerCallbacks,
    callbacks?: CatalogsControllerCallbacks,
  ) {
    this.elements = elements;
    this.downloadService = downloadService;
    this.bookRepo = bookRepo;

    if (sourceRepo && typeof (sourceRepo as SourceRepository).findAll === "function") {
      this.sourceRepo = sourceRepo as SourceRepository;
      this.callbacks = callbacks ?? {};
    } else {
      this.sourceRepo = this.createFallbackSourceRepo();
      this.callbacks = (sourceRepo as CatalogsControllerCallbacks) ?? callbacks ?? {};
    }

    this.opdsClient = createOPDSClient();

    // Restore preferred view mode
    try {
      const savedMode = localStorage.getItem("educk_catalog_view_mode");
      if (savedMode === "grid" || savedMode === "list") {
        this.viewMode = savedMode;
      }
    } catch {
      // Ignore localStorage access failures
    }

    // Subscribe to download progress events if available
    if (typeof this.downloadService.onProgress === "function") {
      this.unsubscribeDownloadProgress = this.downloadService.onProgress((progress) => {
        this.handleDownloadProgress(progress);
      });
    }

    void this.refreshDownloadedBooks();
    this.bindEvents();
    this.setupInfiniteScroll();
    this.loadCatalogs();
  }

  private createFallbackSourceRepo(): SourceRepository {
    const memory = new Map<string, CatalogSource>();
    return {
      findById: async (id) => memory.get(id) ?? null,
      findByUrl: async (url) => Array.from(memory.values()).find((s) => s.url === url) ?? null,
      findAll: async () => Array.from(memory.values()),
      insert: async (source) => { memory.set(source.id, source); },
      update: async (source) => { memory.set(source.id, source); },
      delete: async (id) => { memory.delete(id); },
      count: async () => memory.size,
    };
  }

  private bindEvents(): void {
    // Add catalog modal triggers
    this.elements.addCatalogBtn.addEventListener("click", () => this.showAddCatalogModal());
    this.elements.addCatalogForm.addEventListener("submit", (e) => {
      e.preventDefault();
      this.addCatalog();
    });
    this.elements.addCatalogModal.addEventListener("click", (e) => {
      if (e.target === this.elements.addCatalogModal || (e.target as HTMLElement).classList.contains("modal-close")) {
        this.hideAddCatalogModal();
      }
    });

    // Add catalog auth radios
    const authRadios = this.elements.addCatalogForm.querySelectorAll<HTMLInputElement>('input[name="authType"]');
    authRadios.forEach((radio) => {
      radio.addEventListener("change", () => {
        const type = radio.value;
        const basicFields = this.elements.addCatalogForm.querySelectorAll(".auth-basic");
        const bearerFields = this.elements.addCatalogForm.querySelectorAll(".auth-bearer");
        basicFields.forEach((el) => el.classList.toggle("hidden", type !== "basic"));
        bearerFields.forEach((el) => el.classList.toggle("hidden", type !== "bearer"));
      });
    });

    // Search events
    this.elements.searchBtn.addEventListener("click", () => this.performSearch());
    this.elements.searchInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.performSearch();
      }
    });
    this.elements.searchInput.addEventListener("focus", () => {
      this.showSearchSuggestions(this.elements.searchInput.value.trim());
    });
    this.elements.searchInput.addEventListener("input", () => {
      this.showSearchSuggestions(this.elements.searchInput.value.trim());
    });
    document.addEventListener("click", (e) => {
      if (!this.elements.searchInput.contains(e.target as Node) &&
          !this.elements.searchSuggestions?.contains(e.target as Node)) {
        this.hideSearchSuggestions();
      }
    });

    // Pagination
    this.elements.paginationPrev.addEventListener("click", () => this.loadPrevPage());
    this.elements.paginationNext.addEventListener("click", () => this.loadNextPage(false));

    // Breadcrumb navigation
    this.elements.feedBreadcrumb.addEventListener("click", (e) => {
      const target = (e.target as HTMLElement).closest<HTMLButtonElement>(".breadcrumb-item");
      if (target && target.dataset.level) {
        const level = parseInt(target.dataset.level, 10);
        this.navigateToBreadcrumb(level);
      }
    });

    // Empty state back button
    this.elements.emptyBackBtn?.addEventListener("click", () => {
      this.showView("catalogs");
    });

    // Grid vs. List view toggles
    this.elements.viewGridBtn?.addEventListener("click", () => this.setViewMode("grid"));
    this.elements.viewListBtn?.addEventListener("click", () => this.setViewMode("list"));

    // OPML Import & Export
    this.elements.exportOpmlBtn?.addEventListener("click", () => this.exportOPML());
    this.elements.importOpmlBtn?.addEventListener("click", () => {
      this.elements.opmlFileInput?.click();
    });
    this.elements.opmlFileInput?.addEventListener("change", (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        this.handleOpmlFileSelect(file);
      }
    });

    // Auth Required Modal (Milestone M8)
    if (this.elements.authModal && this.elements.authForm) {
      this.elements.authModal.addEventListener("click", (e) => {
        if (e.target === this.elements.authModal || (e.target as HTMLElement).classList.contains("modal-close")) {
          this.hideAuthModal();
        }
      });

      const feedAuthRadios = this.elements.authForm.querySelectorAll<HTMLInputElement>('input[name="feedAuthType"]');
      feedAuthRadios.forEach((radio) => {
        radio.addEventListener("change", () => {
          const type = radio.value;
          this.elements.authForm?.querySelectorAll(".feed-auth-basic").forEach((el) => {
            el.classList.toggle("hidden", type !== "basic");
          });
          this.elements.authForm?.querySelectorAll(".feed-auth-bearer").forEach((el) => {
            el.classList.toggle("hidden", type !== "bearer");
          });
        });
      });

      this.elements.authForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleAuthSubmit();
      });
    }
  }

  // --- Source / Catalog Persistence via SQLite ---

  public async loadCatalogs(): Promise<void> {
    try {
      const stored = await this.sourceRepo.findAll();
      if (!stored || stored.length === 0) {
        // Seed initial default catalogs into SQLite
        for (const def of DEFAULT_CATALOGS) {
          await this.sourceRepo.insert({
            id: def.id,
            name: def.name,
            url: def.url,
            description: def.description,
            username: null,
            authType: "none",
            authData: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
        const seeded = await this.sourceRepo.findAll();
        this.catalogs = seeded.map(this.mapSourceToCatalog);
      } else {
        this.catalogs = stored.map(this.mapSourceToCatalog);
      }
      this.renderCatalogList();
      this.callbacks.onCatalogsChanged?.(this.catalogs);
    } catch (err) {
      console.warn("Failed to load catalogs from database, falling back to defaults:", err);
      this.catalogs = DEFAULT_CATALOGS.map((c) => ({
        id: c.id,
        name: c.name,
        url: c.url,
        description: c.description,
      }));
      this.renderCatalogList();
      this.callbacks.onCatalogsChanged?.(this.catalogs);
    }
  }

  private mapSourceToCatalog(source: CatalogSource): OPDSCatalog {
    let auth: OPDSCatalogAuth | undefined;
    if (source.authType === "basic") {
      auth = {
        type: "basic",
        username: source.username ?? undefined,
        password: source.authData ?? undefined,
      };
    } else if (source.authType === "bearer") {
      auth = {
        type: "bearer",
        token: source.authData ?? undefined,
      };
    }

    return {
      id: source.id,
      name: source.name,
      url: source.url,
      description: source.description ?? undefined,
      auth,
      lastFetched: source.updatedAt,
    };
  }

  public getCatalogs(): OPDSCatalog[] {
    return [...this.catalogs];
  }

  private renderCatalogList(): void {
    this.showView("catalogs");
    if (this.catalogs.length === 0) {
      this.elements.catalogList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📚</div>
          <h2>No Catalogs Configured</h2>
          <p>Add an OPDS catalog feed or import an OPML collection to browse books.</p>
        </div>
      `;
      return;
    }

    this.elements.catalogList.innerHTML = this.catalogs
      .map(
        (cat) => `
        <article class="catalog-card" data-catalog-id="${cat.id}">
          <div class="catalog-info">
            <h3>${this.escapeHtml(cat.name)}</h3>
            ${cat.description ? `<p class="catalog-desc">${this.escapeHtml(cat.description)}</p>` : ""}
            <span class="catalog-url">${this.escapeHtml(cat.url)}</span>
          </div>
          <div class="catalog-actions">
            <button class="btn-browse" data-catalog-id="${cat.id}">Browse</button>
            <button class="btn-delete" data-catalog-id="${cat.id}" aria-label="Delete ${this.escapeHtml(cat.name)}">✕</button>
          </div>
        </article>
      `,
      )
      .join("");

    this.elements.catalogList.querySelectorAll<HTMLButtonElement>(".btn-browse").forEach((btn) => {
      btn.addEventListener("click", () => {
        const catalogId = btn.dataset.catalogId;
        if (catalogId) this.openCatalog(catalogId);
      });
    });

    this.elements.catalogList.querySelectorAll<HTMLButtonElement>(".btn-delete").forEach((btn) => {
      btn.addEventListener("click", () => {
        const catalogId = btn.dataset.catalogId;
        if (catalogId) this.deleteCatalog(catalogId);
      });
    });
  }

  public async openCatalog(catalogId: string): Promise<void> {
    const catalog = this.catalogs.find((c) => c.id === catalogId);
    if (!catalog) return;

    this.activeFacetFilters.clear();
    this.navigationState = {
      catalogId: catalog.id,
      feedUrl: catalog.url,
      breadcrumbs: [{ title: catalog.name, feedUrl: catalog.url }],
      currentFeed: null,
      isLoading: true,
      error: null,
    };

    await this.loadFeed(catalog.url);
  }

  public async loadFeed(url: string): Promise<void> {
    if (!this.navigationState) {
      const matchedCatalog = this.catalogs.find((c) => c.url === url);
      this.navigationState = {
        catalogId: matchedCatalog?.id ?? "custom",
        feedUrl: url,
        breadcrumbs: [{ title: matchedCatalog?.name ?? "OPDS Catalog", feedUrl: url }],
        currentFeed: null,
        isLoading: true,
        error: null,
      };
    }

    this.showView("feed");
    this.showLoading(true);
    this.clearError();
    this.navigationState.isLoading = true;
    this.navigationState.error = null;

    this.abortController?.abort();
    this.abortController = new AbortController();

    try {
      const auth = this.getAuthForCatalog(this.navigationState.catalogId);
      const feed = await this.opdsClient.fetchFeed(url, {
        signal: this.abortController.signal,
        auth,
      });

      this.navigationState.currentFeed = feed;
      this.navigationState.feedUrl = url;
      this.navigationState.isLoading = false;
      this.allFeedEntries = [...feed.entries];

      await this.refreshDownloadedBooks();
      this.renderFeed(feed);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;

      this.navigationState.isLoading = false;
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.navigationState.error = errorMsg;
      this.lastFailedUrl = url;

      if (err instanceof OPDSAuthError || errorMsg.includes("401") || errorMsg.includes("Unauthorized")) {
        this.showAuthModal(this.navigationState.catalogId);
      } else {
        this.showError(errorMsg, url);
      }

      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.showLoading(false);
    }
  }

  private renderFeed(feed: OPDSFeed): void {
    this.elements.feedTitle.textContent = feed.title || "OPDS Catalog";
    this.renderBreadcrumb();
    this.applyViewMode();
    this.renderFacets(feed);
    this.renderEntries(this.getFilteredEntries());
    this.renderPagination(feed);
  }

  private renderBreadcrumb(): void {
    const state = this.navigationState;
    if (!state) return;

    this.elements.feedBreadcrumb.innerHTML = state.breadcrumbs
      .map(
        (crumb, i) => `
        <button class="breadcrumb-item" data-level="${i}" ${i === state.breadcrumbs.length - 1 ? "disabled" : ""}>
          ${this.escapeHtml(crumb.title)}
        </button>
        ${i < state.breadcrumbs.length - 1 ? '<span class="breadcrumb-sep">›</span>' : ""}
      `,
      )
      .join("");
  }

  // --- View Mode: Grid vs. List ---

  public setViewMode(mode: "grid" | "list"): void {
    this.viewMode = mode;
    try {
      localStorage.setItem("educk_catalog_view_mode", mode);
    } catch {
      // Ignore
    }
    this.applyViewMode();
    if (this.navigationState?.currentFeed) {
      this.renderEntries(this.getFilteredEntries());
    }
  }

  public getViewMode(): "grid" | "list" {
    return this.viewMode;
  }

  private applyViewMode(): void {
    this.elements.feedList.classList.remove("view-grid", "view-list");
    this.elements.feedList.classList.add(`view-${this.viewMode}`);

    if (this.elements.viewGridBtn) {
      this.elements.viewGridBtn.classList.toggle("active", this.viewMode === "grid");
    }
    if (this.elements.viewListBtn) {
      this.elements.viewListBtn.classList.toggle("active", this.viewMode === "list");
    }
  }

  // --- Entries Rendering ---

  private getFilteredEntries(): OPDSEntry[] {
    if (this.activeFacetFilters.size === 0) {
      return this.allFeedEntries;
    }

    return this.allFeedEntries.filter((entry) => {
      for (const [, filterValue] of this.activeFacetFilters) {
        const matchesCategory = entry.categories.some(
          (c) => (c.label || c.term).toLowerCase() === filterValue.toLowerCase(),
        );
        const matchesAuthor = entry.authors.some(
          (a) => a.name.toLowerCase() === filterValue.toLowerCase(),
        );
        if (!matchesCategory && !matchesAuthor) return false;
      }
      return true;
    });
  }

  private renderEntries(entries: OPDSEntry[]): void {
    if (entries.length === 0) {
      this.elements.feedList.innerHTML = "";
      this.elements.feedEmpty.classList.remove("hidden");
      return;
    }

    this.elements.feedEmpty.classList.add("hidden");
    this.elements.feedList.innerHTML = entries
      .map((entry) => (this.viewMode === "grid" ? this.createGridEntryCard(entry) : this.createListEntryCard(entry)))
      .join("");

    this.attachEntryListeners();
  }

  public async refreshDownloadedBooks(): Promise<void> {
    try {
      const books = await this.bookRepo.findAll();
      this.downloadedBookIds = new Set(books.map((b) => b.id));
      this.downloadedRemoteIds = new Set(
        books.filter((b) => b.remoteId).map((b) => b.remoteId as string),
      );
    } catch (err) {
      console.warn("Could not load downloaded books from repository:", err);
    }
  }

  public getBookIdForEntry(entry: OPDSEntry): string {
    return `opds-${entry.id.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48)}`;
  }

  public isBookDownloaded(entry: OPDSEntry): boolean {
    const bookId = this.getBookIdForEntry(entry);
    return this.downloadedBookIds.has(bookId) || (entry.id ? this.downloadedRemoteIds.has(entry.id) : false);
  }

  public isBookDownloading(entry: OPDSEntry): boolean {
    const bookId = this.getBookIdForEntry(entry);
    return this.activeDownloads.has(bookId);
  }

  private renderEntryActions(entry: OPDSEntry): string {
    const bookId = this.getBookIdForEntry(entry);
    const isDownloaded = this.isBookDownloaded(entry);
    const isDownloading = this.isBookDownloading(entry);
    const downloadProgress = this.activeDownloads.get(bookId);

    const openAccessLink = this.opdsClient.getOpenAccessLink(entry);
    const acquisitionLinks = this.opdsClient.getAcquisitionLinks(entry);
    const hasAcquisition = openAccessLink || acquisitionLinks.length > 0;

    let actionBtnHtml: string;
    if (isDownloaded) {
      actionBtnHtml = `<button class="btn-read-now" data-book-id="${bookId}" data-entry-id="${entry.id}">📖 Read Now</button>`;
    } else if (isDownloading) {
      const percent = downloadProgress && downloadProgress.totalBytes && downloadProgress.totalBytes > 0
        ? Math.round((downloadProgress.progress >= 0 ? downloadProgress.progress : 0) * 100)
        : 0;
      const statusText = downloadProgress?.status === "verifying" ? "Verifying..." : `Downloading (${percent}%)`;
      actionBtnHtml = `
        <button class="btn-downloading" data-book-id="${bookId}" data-entry-id="${entry.id}" disabled>
          <span class="spinner">⏳</span> ${statusText}
        </button>
      `;
    } else if (hasAcquisition) {
      actionBtnHtml = `
        <button class="btn-acquire" data-entry-id="${entry.id}" data-book-id="${bookId}">
          ${openAccessLink ? "Download" : "Acquire"}
        </button>
      `;
    } else {
      actionBtnHtml = `<button class="btn-acquire disabled" disabled>Unavailable</button>`;
    }

    const progressBarHtml = isDownloading && downloadProgress
      ? `
        <div class="entry-progress-bar">
          <div class="entry-progress-fill" style="width: ${Math.round((downloadProgress.progress >= 0 ? downloadProgress.progress : 0) * 100)}%"></div>
        </div>
      `
      : "";

    return `
      <div class="entry-actions" data-book-id="${bookId}">
        ${actionBtnHtml}
        <button class="btn-details" data-entry-id="${entry.id}" data-book-id="${bookId}">Details</button>
      </div>
      ${progressBarHtml}
    `;
  }

  private handleDownloadProgress(progress: DownloadProgress): void {
    const bookId = progress.bookId;
    if (progress.status === "downloading" || progress.status === "verifying") {
      this.activeDownloads.set(bookId, progress);
      this.updateCardUi(bookId);
    } else if (progress.status === "completed") {
      this.activeDownloads.delete(bookId);
      this.downloadedBookIds.add(bookId);
      this.updateCardUi(bookId);
    } else if (progress.status === "cancelled" || progress.status === "failed") {
      this.activeDownloads.delete(bookId);
      this.updateCardUi(bookId);
    }
  }

  private updateCardUi(bookId: string): void {
    const card = this.elements.feedList.querySelector<HTMLElement>(`.entry-card[data-book-id="${bookId}"]`);
    if (!card) return;

    const entryId = card.dataset.entryId;
    if (!entryId) return;

    const entry = this.allFeedEntries.find((e) => e.id === entryId);
    if (!entry) return;

    const oldActions = card.querySelector(".entry-actions");
    const oldProgressBar = card.querySelector(".entry-progress-bar");
    if (oldProgressBar) oldProgressBar.remove();

    if (oldActions) {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = this.renderEntryActions(entry);
      const newActions = tempDiv.querySelector(".entry-actions");
      const newProgressBar = tempDiv.querySelector(".entry-progress-bar");

      if (newActions) {
        oldActions.replaceWith(newActions);
      }
      if (newProgressBar && newActions) {
        newActions.insertAdjacentElement("afterend", newProgressBar);
      }

      // Re-attach listeners for the updated elements on this card
      const readNowBtn = card.querySelector<HTMLButtonElement>(".btn-read-now");
      readNowBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.callbacks.onReadNow?.(bookId);
      });

      const acquireBtn = card.querySelector<HTMLButtonElement>(".btn-acquire:not(.disabled)");
      acquireBtn?.addEventListener("click", async (e) => {
        e.stopPropagation();
        await this.acquireEntry(entry);
      });

      const detailsBtn = card.querySelector<HTMLButtonElement>(".btn-details");
      detailsBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.showEntryDetails(entry);
      });
    }
  }

  private createListEntryCard(entry: OPDSEntry): string {
    const bookId = this.getBookIdForEntry(entry);
    const coverLink = this.opdsClient.getCoverLink(entry);
    const authors = entry.authors.map((a) => a.name).join(", ") || "Unknown Author";
    const categories = entry.categories.map((c) => c.label || c.term).join(", ");

    return `
      <article class="entry-card" data-entry-id="${entry.id}" data-book-id="${bookId}">
        <div class="entry-cover">
          ${coverLink
            ? `<img src="${coverLink.href}" alt="" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />`
            : ""}
          <div class="cover-placeholder" style="display: ${coverLink ? "none" : "flex"};">📖</div>
        </div>
        <div class="entry-info">
          <h3 class="entry-title">${this.escapeHtml(entry.title)}</h3>
          <p class="entry-author">${this.escapeHtml(authors)}</p>
          ${categories ? `<p class="entry-categories">${this.escapeHtml(categories)}</p>` : ""}
          <div class="entry-meta">
            ${entry.published ? `<span>Published: ${new Date(entry.published).toLocaleDateString()}</span>` : ""}
            ${entry["dcterms:language"] ? `<span>Lang: ${entry["dcterms:language"]}</span>` : ""}
          </div>
          ${this.renderEntryActions(entry)}
        </div>
      </article>
    `;
  }

  private createGridEntryCard(entry: OPDSEntry): string {
    const bookId = this.getBookIdForEntry(entry);
    const coverLink = this.opdsClient.getCoverLink(entry);
    const authors = entry.authors.map((a) => a.name).join(", ") || "Unknown Author";

    return `
      <article class="entry-card" data-entry-id="${entry.id}" data-book-id="${bookId}">
        <div class="entry-cover">
          ${coverLink
            ? `<img src="${coverLink.href}" alt="" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />`
            : ""}
          <div class="cover-placeholder" style="display: ${coverLink ? "none" : "flex"};">📖</div>
        </div>
        <div class="entry-info">
          <h3 class="entry-title" title="${this.escapeHtml(entry.title)}">${this.escapeHtml(entry.title)}</h3>
          <p class="entry-author">${this.escapeHtml(authors)}</p>
          ${this.renderEntryActions(entry)}
        </div>
      </article>
    `;
  }

  private attachEntryListeners(): void {
    this.elements.feedList.querySelectorAll<HTMLButtonElement>(".btn-acquire:not(.disabled)").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const entryId = btn.dataset.entryId;
        if (entryId && this.navigationState?.currentFeed) {
          const entry = this.allFeedEntries.find((e) => e.id === entryId);
          if (entry) await this.acquireEntry(entry);
        }
      });
    });

    this.elements.feedList.querySelectorAll<HTMLButtonElement>(".btn-read-now").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const bookId = btn.dataset.bookId;
        if (bookId) {
          this.callbacks.onReadNow?.(bookId);
        }
      });
    });

    this.elements.feedList.querySelectorAll<HTMLButtonElement>(".btn-details").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const entryId = btn.dataset.entryId;
        if (entryId && this.navigationState?.currentFeed) {
          const entry = this.allFeedEntries.find((e) => e.id === entryId);
          if (entry) this.showEntryDetails(entry);
        }
      });
    });

    // Clicking anywhere on a card (outside buttons) opens the book if downloaded
    this.elements.feedList.querySelectorAll<HTMLElement>(".entry-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        const bookId = card.dataset.bookId;
        const entryId = card.dataset.entryId;
        if (bookId && entryId) {
          const entry = this.allFeedEntries.find((item) => item.id === entryId);
          if (entry && this.isBookDownloaded(entry)) {
            this.callbacks.onReadNow?.(bookId);
          }
        }
      });
    });
  }

  // --- Facets Filtering UI (Milestone M8) ---

  private renderFacets(feed: OPDSFeed): void {
    if (!this.elements.facetsContainer) return;

    const facets = feed.facets ?? [];
    if (facets.length === 0) {
      this.elements.facetsContainer.innerHTML = "";
      this.elements.facetsContainer.classList.add("hidden");
      return;
    }

    this.elements.facetsContainer.classList.remove("hidden");
    this.elements.facetsContainer.innerHTML = facets
      .map((facetGroup) => this.createFacetGroupHtml(facetGroup))
      .join("");

    this.attachFacetListeners(facets);
  }

  private createFacetGroupHtml(group: OPDSFacet): string {
    const activeValue = this.activeFacetFilters.get(group.name);
    const isAllActive = !activeValue;

    return `
      <div class="facet-group" data-facet-group="${this.escapeHtml(group.name)}">
        <span class="facet-group-title">${this.escapeHtml(group.name)}:</span>
        <div class="facet-chips">
          <button class="facet-chip ${isAllActive ? "active" : ""}" data-facet-group="${this.escapeHtml(group.name)}" data-facet-value="__all__">All</button>
          ${group.values
            .map((val) => {
              const isActive = (val.active && !activeValue) || activeValue === val.value;
              const countText = val.count ? `<span class="facet-count">(${val.count})</span>` : "";
              return `
                <button class="facet-chip ${isActive ? "active" : ""}"
                        data-facet-group="${this.escapeHtml(group.name)}"
                        data-facet-value="${this.escapeHtml(val.value)}"
                        ${val.href ? `data-href="${this.escapeHtml(val.href)}"` : ""}>
                  ${this.escapeHtml(val.label || val.value)} ${countText}
                </button>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  private attachFacetListeners(_facets: OPDSFacet[]): void {
    if (!this.elements.facetsContainer) return;

    this.elements.facetsContainer.querySelectorAll<HTMLButtonElement>(".facet-chip").forEach((chip) => {
      chip.addEventListener("click", async () => {
        const group = chip.dataset.facetGroup;
        const value = chip.dataset.facetValue;
        const href = chip.dataset.href;

        if (!group || !value) return;

        if (href) {
          // If facet points to a remote feed URL, navigate to that feed
          await this.loadFeed(href);
          return;
        }

        // Local filtering
        if (value === "__all__") {
          this.activeFacetFilters.delete(group);
        } else {
          this.activeFacetFilters.set(group, value);
        }

        if (this.navigationState?.currentFeed) {
          this.renderFacets(this.navigationState.currentFeed);
          this.renderEntries(this.getFilteredEntries());
        }
      });
    });
  }

  // --- Search Suggestions & Recent Searches (Milestone M8) ---

  private getRecentSearches(): string[] {
    try {
      const raw = localStorage.getItem("educk_recent_searches");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private addRecentSearch(query: string): void {
    const trimmed = query.trim();
    if (!trimmed) return;
    try {
      const recents = this.getRecentSearches().filter((s) => s.toLowerCase() !== trimmed.toLowerCase());
      recents.unshift(trimmed);
      localStorage.setItem("educk_recent_searches", JSON.stringify(recents.slice(0, 10)));
    } catch {
      // Ignore
    }
  }

  public clearRecentSearches(): void {
    try {
      localStorage.removeItem("educk_recent_searches");
    } catch {
      // Ignore
    }
    this.hideSearchSuggestions();
  }

  public showSearchSuggestions(filterText?: string): void {
    if (!this.elements.searchSuggestions) return;

    const recents = this.getRecentSearches();
    const query = (filterText ?? "").toLowerCase();

    const filteredRecents = query
      ? recents.filter((s) => s.toLowerCase().includes(query))
      : recents;

    const filteredTopics = query
      ? SEARCH_SUGGESTION_TOPICS.filter((t) => t.toLowerCase().includes(query))
      : SEARCH_SUGGESTION_TOPICS;

    if (filteredRecents.length === 0 && filteredTopics.length === 0) {
      this.hideSearchSuggestions();
      return;
    }

    let html = "";
    if (filteredRecents.length > 0) {
      html += `
        <div class="recent-search-header">
          <span>Recent Searches</span>
          <button class="btn-clear-recent" type="button">Clear</button>
        </div>
      `;
      for (const item of filteredRecents) {
        html += `
          <div class="suggestion-item" data-suggestion="${this.escapeHtml(item)}">
            <span class="suggestion-icon">🕒</span>
            <span>${this.escapeHtml(item)}</span>
          </div>
        `;
      }
    }

    if (filteredTopics.length > 0) {
      html += `<div class="recent-search-header"><span>Suggestions</span></div>`;
      for (const topic of filteredTopics.slice(0, 5)) {
        html += `
          <div class="suggestion-item" data-suggestion="${this.escapeHtml(topic)}">
            <span class="suggestion-icon">🔍</span>
            <span>${this.escapeHtml(topic)}</span>
          </div>
        `;
      }
    }

    this.elements.searchSuggestions.innerHTML = html;
    this.elements.searchSuggestions.classList.remove("hidden");

    this.elements.searchSuggestions.querySelector(".btn-clear-recent")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.clearRecentSearches();
    });

    this.elements.searchSuggestions.querySelectorAll<HTMLElement>(".suggestion-item").forEach((item) => {
      item.addEventListener("click", () => {
        const text = item.dataset.suggestion;
        if (text) {
          this.elements.searchInput.value = text;
          this.hideSearchSuggestions();
          this.performSearch();
        }
      });
    });
  }

  public hideSearchSuggestions(): void {
    if (this.elements.searchSuggestions) {
      this.elements.searchSuggestions.classList.add("hidden");
    }
  }

  public async performSearch(): Promise<void> {
    const query = this.elements.searchInput.value.trim();
    if (!query || !this.navigationState?.currentFeed) return;

    this.addRecentSearch(query);
    this.hideSearchSuggestions();

    const searchLink = this.opdsClient.getSearchLink(this.navigationState.currentFeed);
    if (!searchLink) {
      // Local title/author/category filter fallback when server search template is not available
      const searchTerms = query.toLowerCase().split(/\s+/);
      const matches = this.allFeedEntries.filter((entry) => {
        const searchable = `${entry.title} ${entry.authors.map((a) => a.name).join(" ")} ${entry.categories.map((c) => c.label || c.term).join(" ")}`.toLowerCase();
        return searchTerms.every((term) => searchable.includes(term));
      });
      this.renderEntries(matches);
      return;
    }

    const searchUrl = new URL(searchLink.href);
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("count", "20");

    this.navigationState.breadcrumbs.push({
      title: `Search: "${query}"`,
      feedUrl: searchUrl.href,
    });

    await this.loadFeed(searchUrl.href);
  }

  // --- Infinite Scroll & Pagination ---

  private setupInfiniteScroll(): void {
    if (!this.elements.scrollSentinel || typeof IntersectionObserver === "undefined") return;

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && !this.isLoadingNextPage && this.navigationState?.currentFeed) {
          const nextLink = this.opdsClient.getNextPageLink(this.navigationState.currentFeed);
          if (nextLink) {
            void this.loadNextPage(true);
          }
        }
      },
      { root: null, rootMargin: "200px" },
    );

    this.intersectionObserver.observe(this.elements.scrollSentinel);
  }

  public async loadNextPage(isInfinite = false): Promise<void> {
    if (!this.navigationState?.currentFeed || this.isLoadingNextPage) return;
    const nextLink = this.opdsClient.getNextPageLink(this.navigationState.currentFeed);
    if (!nextLink) return;

    if (!isInfinite) {
      await this.loadFeed(nextLink.href);
      return;
    }

    // Infinite scroll mode: append entries to existing list
    this.isLoadingNextPage = true;
    try {
      const auth = this.getAuthForCatalog(this.navigationState.catalogId);
      const nextPageFeed = await this.opdsClient.fetchFeed(nextLink.href, { auth });

      this.allFeedEntries.push(...nextPageFeed.entries);
      this.navigationState.currentFeed.entries = [...this.allFeedEntries];
      this.navigationState.currentFeed.links = nextPageFeed.links;

      // Append rendered items
      const newItemsHtml = nextPageFeed.entries
        .map((entry) => (this.viewMode === "grid" ? this.createGridEntryCard(entry) : this.createListEntryCard(entry)))
        .join("");

      this.elements.feedList.insertAdjacentHTML("beforeend", newItemsHtml);
      this.attachEntryListeners();
      this.renderPagination(this.navigationState.currentFeed);
    } catch (err) {
      console.warn("Failed to load next page infinitely:", err);
    } finally {
      this.isLoadingNextPage = false;
    }
  }

  public async loadPrevPage(): Promise<void> {
    if (this.navigationState && this.navigationState.breadcrumbs.length > 1) {
      this.navigateToBreadcrumb(this.navigationState.breadcrumbs.length - 2);
    }
  }

  private navigateToBreadcrumb(level: number): void {
    if (!this.navigationState) return;
    const target = this.navigationState.breadcrumbs[level];
    if (!target) return;

    this.navigationState.breadcrumbs = this.navigationState.breadcrumbs.slice(0, level + 1);
    this.loadFeed(target.feedUrl);
  }

  private renderPagination(feed: OPDSFeed): void {
    const hasNext = !!this.opdsClient.getNextPageLink(feed);
    const hasPrev = !!(this.navigationState && this.navigationState.breadcrumbs.length > 1);

    this.elements.paginationPrev.disabled = !hasPrev;
    this.elements.paginationNext.disabled = !hasNext;

    let info = "";
    if (feed.totalResults !== undefined) {
      info = `Showing ${this.allFeedEntries.length} of ${feed.totalResults} books`;
    } else if (this.allFeedEntries.length > 0) {
      info = `${this.allFeedEntries.length} books`;
    }
    this.elements.paginationInfo.textContent = info;
  }

  // --- OPML Catalog Import / Export (Milestone M8) ---

  public exportOPML(): string {
    const xml = exportCatalogsToOPML(this.catalogs);

    // Trigger download in browser
    try {
      const blob = new Blob([xml], { type: "text/xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "educk-catalogs.opml";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn("Could not trigger OPML file download directly:", err);
    }

    return xml;
  }

  public async importOPML(opmlXml: string): Promise<number> {
    const outlines = parseOPML(opmlXml);
    let importedCount = 0;

    for (const outline of outlines) {
      const existing = this.catalogs.find((c) => c.url.toLowerCase() === outline.url.toLowerCase());
      if (!existing) {
        const id = outline.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `catalog-${Date.now()}`;
        const source: CatalogSource = {
          id,
          name: outline.name,
          url: outline.url,
          description: outline.description ?? null,
          username: null,
          authType: "none",
          authData: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await this.sourceRepo.insert(source);
        importedCount++;
      }
    }

    await this.loadCatalogs();
    return importedCount;
  }

  private handleOpmlFileSelect(file: File): void {
    const reader = new FileReader();
    reader.onload = async () => {
      const text = reader.result as string;
      try {
        const count = await this.importOPML(text);
        alert(`Successfully imported ${count} catalog${count === 1 ? "" : "s"}.`);
      } catch (err) {
        alert(`OPML import failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsText(file);
  }

  // --- Catalog CRUD ---

  private showAddCatalogModal(): void {
    this.elements.addCatalogModal.classList.remove("hidden");
    (this.elements.addCatalogModal.querySelector("input[name='name']") as HTMLInputElement)?.focus();
  }

  private hideAddCatalogModal(): void {
    this.elements.addCatalogModal.classList.add("hidden");
    this.elements.addCatalogForm.reset();
  }

  public async addCatalog(customCatalog?: OPDSCatalog): Promise<void> {
    let name: string;
    let url: string;
    let description: string | undefined;
    let authType: AuthType;
    let username: string | undefined;
    let password: string | undefined;
    let token: string | undefined;

    if (customCatalog) {
      name = customCatalog.name;
      url = customCatalog.url;
      description = customCatalog.description;
      authType = customCatalog.auth?.type ?? "none";
      username = customCatalog.auth?.username;
      password = customCatalog.auth?.password;
      token = customCatalog.auth?.token;
    } else {
      const formData = new FormData(this.elements.addCatalogForm);
      name = (formData.get("name") as string)?.trim();
      url = (formData.get("url") as string)?.trim();
      description = (formData.get("description") as string)?.trim();
      authType = (formData.get("authType") as AuthType) || "none";
      username = (formData.get("username") as string)?.trim() || undefined;
      password = (formData.get("password") as string)?.trim() || undefined;
      token = (formData.get("token") as string)?.trim() || undefined;
    }

    if (!name || !url) {
      alert("Name and URL are required");
      return;
    }

    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `catalog-${Date.now()}`;
    const source: CatalogSource = {
      id,
      name,
      url,
      description: description || null,
      username: authType === "basic" ? username ?? null : null,
      authType,
      authData: authType === "basic" ? password ?? null : authType === "bearer" ? token ?? null : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await this.sourceRepo.insert(source);
      await this.loadCatalogs();
      this.hideAddCatalogModal();
    } catch (err) {
      console.error("Failed to add catalog:", err);
      alert(`Failed to add catalog: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public async deleteCatalog(catalogId: string): Promise<void> {
    if (!confirm("Delete this catalog from your sources?")) return;

    try {
      await this.sourceRepo.delete(catalogId);
      await this.loadCatalogs();
    } catch (err) {
      console.error("Failed to delete catalog:", err);
      alert(`Failed to delete catalog: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- Authentication Prompt (401 / 403 Handler) ---

  private showAuthModal(catalogId: string): void {
    if (!this.elements.authModal) return;
    const catalog = this.catalogs.find((c) => c.id === catalogId);
    if (this.elements.authMessage) {
      this.elements.authMessage.textContent = `Catalog "${catalog?.name ?? "OPDS"}" requires authentication to view this feed.`;
    }
    this.elements.authModal.classList.remove("hidden");
  }

  private hideAuthModal(): void {
    if (this.elements.authModal) {
      this.elements.authModal.classList.add("hidden");
      this.elements.authForm?.reset();
    }
  }

  private async handleAuthSubmit(): Promise<void> {
    if (!this.elements.authForm || !this.navigationState) return;

    const formData = new FormData(this.elements.authForm);
    const authType = (formData.get("feedAuthType") as AuthType) || "basic";
    const username = (formData.get("username") as string)?.trim() || undefined;
    const password = (formData.get("password") as string)?.trim() || undefined;
    const token = (formData.get("token") as string)?.trim() || undefined;

    const catalogId = this.navigationState.catalogId;
    const catalog = this.catalogs.find((c) => c.id === catalogId);

    if (catalog) {
      catalog.auth = {
        type: authType,
        username,
        password,
        token,
      };

      const existingSource = await this.sourceRepo.findById(catalogId);
      if (existingSource) {
        existingSource.authType = authType;
        existingSource.username = authType === "basic" ? username ?? null : null;
        existingSource.authData = authType === "basic" ? password ?? null : authType === "bearer" ? token ?? null : null;
        existingSource.updatedAt = new Date().toISOString();
        await this.sourceRepo.update(existingSource);
      }
    }

    this.hideAuthModal();
    if (this.lastFailedUrl) {
      await this.loadFeed(this.lastFailedUrl);
    }
  }

  private getAuthForCatalog(catalogId: string): OPDSCatalogAuth | undefined {
    const catalog = this.catalogs.find((c) => c.id === catalogId);
    return catalog?.auth;
  }

  // --- Download & Details ---

  private async acquireEntry(entry: OPDSEntry): Promise<void> {
    const openAccessLink = this.opdsClient.getOpenAccessLink(entry);
    const acquisitionLinks = this.opdsClient.getAcquisitionLinks(entry);

    let downloadUrl: string;
    let acquisitionType: string;

    if (openAccessLink) {
      downloadUrl = openAccessLink.href;
      acquisitionType = "open-access";
    } else if (acquisitionLinks.length === 1) {
      downloadUrl = acquisitionLinks[0].href;
      acquisitionType = acquisitionLinks[0].rel;
    } else if (acquisitionLinks.length > 1) {
      this.showAcquisitionModal(entry, acquisitionLinks);
      return;
    } else {
      alert("No downloadable EPUB link found for this entry.");
      return;
    }

    await this.startDownload(entry, downloadUrl, acquisitionType);
  }

  private showAcquisitionModal(entry: OPDSEntry, links: AcquisitionLink[]): void {
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <div class="modal acquisition-modal">
        <h3>Choose acquisition option for "${this.escapeHtml(entry.title)}"</h3>
        <ul class="acquisition-options">
          ${links
            .map(
              (link) => `
            <li>
              <button class="acquisition-option" data-url="${link.href}" data-type="${link.rel}">
                <span class="acq-type">${this.formatAcquisitionType(link.rel)}</span>
                ${link["opds:price"] ? `<span class="acq-price">${link["opds:price"]}</span>` : ""}
                ${link.type ? `<span class="acq-format">${link.type}</span>` : ""}
                ${link.length ? `<span class="acq-size">${this.formatBytes(link.length)}</span>` : ""}
              </button>
            </li>
          `,
            )
            .join("")}
        </ul>
        <button class="btn btn-secondary modal-close">Cancel</button>
      </div>
    `;

    modal.querySelectorAll<HTMLButtonElement>(".acquisition-option").forEach((opt) => {
      opt.addEventListener("click", async () => {
        const url = opt.dataset.url!;
        const type = opt.dataset.type!;
        modal.remove();
        await this.startDownload(entry, url, type);
      });
    });

    modal.querySelector(".modal-close")?.addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);
  }

  public async startDownload(entry: OPDSEntry, url: string, _acquisitionType: string): Promise<void> {
    const bookId = this.getBookIdForEntry(entry);

    const existing = await this.bookRepo.findById(bookId);
    if (existing) {
      this.downloadedBookIds.add(bookId);
      this.callbacks.onReadNow?.(bookId);
      return;
    }

    const openAccessLink = this.opdsClient.getOpenAccessLink(entry);
    const downloadRequest = {
      bookId,
      url,
      title: entry.title,
      subtitle: entry.published,
      authors: entry.authors.map((a) => a.name).join(", "),
      coverUrl: this.opdsClient.getCoverLink(entry)?.href ?? null,
      sourceId: this.navigationState?.catalogId ?? null,
      remoteId: entry.id,
      expectedSize: openAccessLink?.length,
    };

    // Mark as downloading immediately in UI
    this.activeDownloads.set(bookId, {
      bookId,
      status: "downloading",
      bytesDownloaded: 0,
      totalBytes: openAccessLink?.length,
      progress: 0,
    });
    this.updateCardUi(bookId);

    try {
      this.callbacks.onDownloadStarted?.(bookId);
      const result = await this.downloadService.downloadBook(downloadRequest);

      // Register downloaded book into SQLite BookRepository
      const bookRecord: Book = {
        id: bookId,
        sourceId: this.navigationState?.catalogId ?? null,
        remoteId: entry.id,
        title: entry.title,
        subtitle: entry.published ?? null,
        authors: entry.authors.map((a) => a.name).join(", ") || null,
        coverUrl: this.opdsClient.getCoverLink(entry)?.href ?? null,
        acquisitionUrl: url,
        mimeType: "application/epub+zip",
        localPath: result.localPath,
        fileSize: result.fileSize,
        downloadedAt: new Date().toISOString(),
      };

      await this.bookRepo.insert(bookRecord);
      this.downloadedBookIds.add(bookId);
      if (entry.id) {
        this.downloadedRemoteIds.add(entry.id);
      }

      const progressionLink = this.opdsClient.getProgressionLink(entry);
      if (progressionLink?.href) {
        this.callbacks.onProgressionDiscovered?.(bookId, progressionLink.href);
      }

      this.activeDownloads.delete(bookId);
      this.updateCardUi(bookId);

      this.callbacks.onBookAcquired?.(bookRecord);
      this.callbacks.onDownloadCompleted?.(bookRecord);
    } catch (err) {
      this.activeDownloads.delete(bookId);
      this.updateCardUi(bookId);
      console.error("Download failed:", err);
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      alert(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private showEntryDetails(entry: OPDSEntry): void {
    const bookId = this.getBookIdForEntry(entry);
    const isDownloaded = this.isBookDownloaded(entry);
    const isDownloading = this.isBookDownloading(entry);
    const openAccessLink = this.opdsClient.getOpenAccessLink(entry);
    const acquisitionLinks = this.opdsClient.getAcquisitionLinks(entry);
    const hasAcquisition = openAccessLink || acquisitionLinks.length > 0;

    let actionBtnHtml = "";
    if (isDownloaded) {
      actionBtnHtml = `<button class="btn btn-primary modal-read-now" data-book-id="${bookId}">📖 Read Now</button>`;
    } else if (isDownloading) {
      actionBtnHtml = `<button class="btn btn-secondary modal-downloading" disabled>⏳ Downloading...</button>`;
    } else if (hasAcquisition) {
      actionBtnHtml = `<button class="btn btn-primary modal-acquire" data-entry-id="${entry.id}">⬇️ ${openAccessLink ? "Download EPUB" : "Acquire EPUB"}</button>`;
    }

    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <div class="modal details-modal">
        <h3>${this.escapeHtml(entry.title)}</h3>
        <div class="details-content">
          <p><strong>Author(s):</strong> ${entry.authors.map((a) => this.escapeHtml(a.name)).join(", ")}</p>
          ${entry.summary ? `<p><strong>Description:</strong> ${this.escapeHtml(entry.summary)}</p>` : ""}
          ${entry.published ? `<p><strong>Published:</strong> ${new Date(entry.published).toLocaleDateString()}</p>` : ""}
          ${entry["dcterms:publisher"] ? `<p><strong>Publisher:</strong> ${this.escapeHtml(entry["dcterms:publisher"])}</p>` : ""}
          ${entry["dcterms:language"] ? `<p><strong>Language:</strong> ${entry["dcterms:language"]}</p>` : ""}
          ${entry["dcterms:identifier"] ? `<p><strong>Identifier:</strong> ${entry["dcterms:identifier"]}</p>` : ""}
          ${entry.categories.length > 0 ? `<p><strong>Categories:</strong> ${entry.categories.map((c) => this.escapeHtml(c.label || c.term)).join(", ")}</p>` : ""}
          <p><strong>ID:</strong> <code>${this.escapeHtml(entry.id)}</code></p>
        </div>
        <div class="modal-actions form-actions">
          ${actionBtnHtml}
          <button class="btn btn-secondary modal-close">Close</button>
        </div>
      </div>
    `;

    modal.querySelector(".modal-read-now")?.addEventListener("click", () => {
      modal.remove();
      this.callbacks.onReadNow?.(bookId);
    });

    modal.querySelector(".modal-acquire")?.addEventListener("click", async () => {
      modal.remove();
      await this.acquireEntry(entry);
    });

    modal.querySelector(".modal-close")?.addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });
    document.body.appendChild(modal);
  }

  // --- View Helpers ---

  private showView(mode: "catalogs" | "feed"): void {
    const isCatalogs = mode === "catalogs";
    this.elements.catalogList.closest("section")?.classList.toggle("hidden", false);
    this.elements.catalogList.classList.toggle("hidden", !isCatalogs);
    this.elements.feedView.classList.toggle("hidden", isCatalogs);
  }

  private showLoading(show: boolean): void {
    this.elements.feedLoading.classList.toggle("hidden", !show);
    this.elements.feedList.classList.toggle("hidden", show);
    this.elements.paginationPrev.disabled = show;
    this.elements.paginationNext.disabled = show;
  }

  private showError(message: string, retryUrl?: string): void {
    this.elements.feedError.innerHTML = `
      <div class="feed-error-banner">
        <p>${this.escapeHtml(message)}</p>
        ${retryUrl ? '<button class="btn-retry" type="button">↻ Retry</button>' : ""}
      </div>
    `;
    this.elements.feedError.classList.remove("hidden");

    if (retryUrl) {
      this.elements.feedError.querySelector(".btn-retry")?.addEventListener("click", () => {
        this.clearError();
        void this.loadFeed(retryUrl);
      });
    }
  }

  private clearError(): void {
    this.elements.feedError.innerHTML = "";
    this.elements.feedError.classList.add("hidden");
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  private formatAcquisitionType(rel: string): string {
    if (rel.includes("open-access")) return "Free Download";
    if (rel.includes("borrow")) return "Borrow";
    if (rel.includes("buy")) return "Purchase";
    if (rel.includes("sample")) return "Sample";
    if (rel.includes("loan")) return "Loan";
    return rel;
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  public destroy(): void {
    this.abortController?.abort();
    this.intersectionObserver?.disconnect();
    if (this.unsubscribeDownloadProgress) {
      this.unsubscribeDownloadProgress();
      this.unsubscribeDownloadProgress = null;
    }
  }
}