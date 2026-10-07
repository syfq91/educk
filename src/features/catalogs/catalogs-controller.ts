/**
 * CatalogsController
 *
 * Manages the OPDS Catalogs view:
 * - Displays configured OPDS catalogs
 * - Navigates feed hierarchy (subsections, search, pagination)
 * - Shows entry lists with cover, title, author, metadata
 * - Initiates downloads via DownloadService
 */

import { invoke } from "@tauri-apps/api/core";
import { OPDSClient, createOPDSClient } from "../../services/opds/index.ts";
import type {
  OPDSFeed,
  OPDSEntry,
  OPDSCatalog,
  OPDSCatalogAuth,
  OPDSNavigationState,
  AcquisitionLink,
} from "../../domain/opds.ts";
import type { DownloadService } from "../../domain/downloads.ts";
import type { BookRepository } from "../../domain/database.ts";

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
}

export interface CatalogsControllerCallbacks {
  onDownloadStarted?: (bookId: string) => void;
  onError?: (error: Error) => void;
}

export class CatalogsController {
  private elements: CatalogsUiElements;
  private opdsClient: OPDSClient;
  private downloadService: DownloadService;
  private bookRepo: BookRepository;
  private callbacks: CatalogsControllerCallbacks;
  private catalogs: OPDSCatalog[] = [];
  private navigationState: OPDSNavigationState | null = null;
  private abortController: AbortController | null = null;

  constructor(
    elements: CatalogsUiElements,
    downloadService: DownloadService,
    bookRepo: BookRepository,
    callbacks?: CatalogsControllerCallbacks,
  ) {
    this.elements = elements;
    this.downloadService = downloadService;
    this.bookRepo = bookRepo;
    this.callbacks = callbacks ?? {};
    this.opdsClient = createOPDSClient();
    this.bindEvents();
    this.loadCatalogs();
  }

  private bindEvents(): void {
    // Add catalog button
    this.elements.addCatalogBtn.addEventListener("click", () => this.showAddCatalogModal());

    // Add catalog form
    this.elements.addCatalogForm.addEventListener("submit", (e) => {
      e.preventDefault();
      this.addCatalog();
    });

    // Close modal on backdrop click
    this.elements.addCatalogModal.addEventListener("click", (e) => {
      if (e.target === this.elements.addCatalogModal) {
        this.hideAddCatalogModal();
      }
    });

    // Search
    this.elements.searchBtn.addEventListener("click", () => this.performSearch());
    this.elements.searchInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.performSearch();
    });

    // Pagination
    this.elements.paginationPrev.addEventListener("click", () => this.loadPrevPage());
    this.elements.paginationNext.addEventListener("click", () => this.loadNextPage());

    // Back to catalogs from feed view
    this.elements.feedBreadcrumb.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "BUTTON" && target.dataset.level) {
        const level = parseInt(target.dataset.level, 10);
        this.navigateToBreadcrumb(level);
      }
    });
  }

  private async loadCatalogs(): Promise<void> {
    try {
      // Load from Tauri command (stored in SQLite sources table)
      const catalogs = await invoke<OPDSCatalog[]>("get_catalogs");
      this.catalogs = catalogs;
      this.renderCatalogList();
    } catch (err) {
      console.warn("Failed to load catalogs, using defaults:", err);
      // Fallback to defaults for demo
      this.catalogs = [
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
      this.renderCatalogList();
    }
  }

  private renderCatalogList(): void {
    this.showView("catalogs");
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
            <button class="btn-delete" data-catalog-id="${cat.id}">✕</button>
          </div>
        </article>
      `,
      )
      .join("");

    // Attach listeners
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

  private async openCatalog(catalogId: string): Promise<void> {
    const catalog = this.catalogs.find((c) => c.id === catalogId);
    if (!catalog) return;

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

  private async loadFeed(url: string): Promise<void> {
    if (!this.navigationState) return;

    this.showView("feed");
    this.showLoading(true);
    this.navigationState.isLoading = true;
    this.navigationState.error = null;

    this.abortController = new AbortController();

    try {
      const feed = await this.opdsClient.fetchFeed(url, {
        signal: this.abortController.signal,
        auth: this.getAuthForCatalog(this.navigationState.catalogId),
      });

      this.navigationState.currentFeed = feed;
      this.navigationState.feedUrl = url;
      this.navigationState.isLoading = false;

      this.renderFeed(feed);
    } catch (err) {
      this.navigationState.isLoading = false;
      this.navigationState.error = err instanceof Error ? err.message : String(err);
      this.showError(err instanceof Error ? err.message : String(err));
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.showLoading(false);
    }
  }

  private renderFeed(feed: OPDSFeed): void {
    this.elements.feedTitle.textContent = feed.title;
    this.renderBreadcrumb();
    this.renderEntries(feed.entries);
    this.renderPagination(feed);
    this.renderFacets(feed);
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

  private renderEntries(entries: OPDSEntry[]): void {
    if (entries.length === 0) {
      this.elements.feedList.innerHTML = "";
      this.elements.feedEmpty.classList.remove("hidden");
      return;
    }

    this.elements.feedEmpty.classList.add("hidden");
    this.elements.feedList.innerHTML = entries
      .map((entry) => this.createEntryCard(entry))
      .join("");

    // Attach entry listeners
    this.attachEntryListeners();
  }

  private createEntryCard(entry: OPDSEntry): string {
    const coverLink = this.opdsClient.getCoverLink(entry);
    const openAccessLink = this.opdsClient.getOpenAccessLink(entry);
    const acquisitionLinks = this.opdsClient.getAcquisitionLinks(entry);
    const hasAcquisition = openAccessLink || acquisitionLinks.length > 0;

    const authors = entry.authors.map((a) => a.name).join(", ") || "Unknown Author";
    const categories = entry.categories.map((c) => c.label || c.term).join(", ");

    return `
      <article class="entry-card" data-entry-id="${entry.id}">
        <div class="entry-cover">
          ${coverLink ? `<img src="${coverLink.href}" alt="" loading="lazy" />` : '<div class="cover-placeholder">📖</div>'}
        </div>
        <div class="entry-info">
          <h3 class="entry-title">${this.escapeHtml(entry.title)}</h3>
          <p class="entry-author">${this.escapeHtml(authors)}</p>
          ${categories ? `<p class="entry-categories">${this.escapeHtml(categories)}</p>` : ""}
          <div class="entry-meta">
            ${entry.published ? `<span>Published: ${new Date(entry.published).toLocaleDateString()}</span>` : ""}
            ${entry["dcterms:language"] ? `<span>Lang: ${entry["dcterms:language"]}</span>` : ""}
          </div>
          <div class="entry-actions">
            ${hasAcquisition
              ? `<button class="btn-acquire" data-entry-id="${entry.id}" ${!openAccessLink && acquisitionLinks.length === 1 ? `data-single-acquisition="${acquisitionLinks[0].href}"` : ""}>
                  ${openAccessLink ? "Download" : "Acquire"}
                </button>`
              : '<button class="btn-acquire disabled" disabled>No Download</button>'}
            <button class="btn-details" data-entry-id="${entry.id}">Details</button>
          </div>
        </div>
      </article>
    `;
  }

  private attachEntryListeners(): void {
    // Acquire buttons
    this.elements.feedList.querySelectorAll<HTMLButtonElement>(".btn-acquire:not(.disabled)").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const entryId = btn.dataset.entryId;
        if (entryId && this.navigationState?.currentFeed) {
          const entry = this.navigationState.currentFeed.entries.find((e) => e.id === entryId);
          if (entry) await this.acquireEntry(entry);
        }
      });
    });

    // Details buttons
    this.elements.feedList.querySelectorAll<HTMLButtonElement>(".btn-details").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const entryId = btn.dataset.entryId;
        if (entryId && this.navigationState?.currentFeed) {
          const entry = this.navigationState.currentFeed.entries.find((e) => e.id === entryId);
          if (entry) this.showEntryDetails(entry);
        }
      });
    });
  }

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
    } else {
      // Multiple acquisition options - show modal
      this.showAcquisitionModal(entry, acquisitionLinks);
      return;
    }

    await this.startDownload(entry, downloadUrl, acquisitionType);
  }

  private showAcquisitionModal(entry: OPDSEntry, links: AcquisitionLink[]): void {
    // Create modal dynamically
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

  private async startDownload(entry: OPDSEntry, url: string, _acquisitionType: string): Promise<void> {
    const bookId = `opds-${entry.id.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48)}`;

    // Check if already in library
    const existing = await this.bookRepo.findById(bookId);
    if (existing) {
      alert("This book is already in your library.");
      return;
    }

    const openAccessLink = this.opdsClient.getOpenAccessLink(entry);

    try {
      await this.downloadService.downloadBook({
        bookId,
        url,
        title: entry.title,
        subtitle: entry.published,
        authors: entry.authors.map((a) => a.name).join(", "),
        coverUrl: this.opdsClient.getCoverLink(entry)?.href ?? null,
        sourceId: this.navigationState?.catalogId ?? null,
        remoteId: entry.id,
        expectedSize: openAccessLink?.length,
      });

      this.callbacks.onDownloadStarted?.(bookId);
    } catch (err) {
      console.error("Download failed:", err);
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      alert(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private getAuthForCatalog(catalogId: string): OPDSCatalogAuth | undefined {
    const catalog = this.catalogs.find((c) => c.id === catalogId);
    return catalog?.auth;
  }

  private async performSearch(): Promise<void> {
    const query = this.elements.searchInput.value.trim();
    if (!query || !this.navigationState?.currentFeed) return;

    const searchLink = this.opdsClient.getSearchLink(this.navigationState.currentFeed);
    if (!searchLink) {
      alert("Search not supported for this feed");
      return;
    }

    const searchUrl = new URL(searchLink.href);
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("count", "20");

    // Add search to breadcrumbs
    this.navigationState.breadcrumbs.push({ title: `Search: ${query}`, feedUrl: searchUrl.href });

    await this.loadFeed(searchUrl.href);
  }

  private async loadNextPage(): Promise<void> {
    if (!this.navigationState?.currentFeed) return;
    const nextLink = this.opdsClient.getNextPageLink(this.navigationState.currentFeed);
    if (!nextLink) return;

    await this.loadFeed(nextLink.href);
  }

  private async loadPrevPage(): Promise<void> {
    // OPDS doesn't always have previous, would need to track history
    // For now, navigate back via breadcrumb
    if (this.navigationState && this.navigationState.breadcrumbs.length > 1) {
      this.navigateToBreadcrumb(this.navigationState.breadcrumbs.length - 2);
    }
  }

  private navigateToBreadcrumb(level: number): void {
    if (!this.navigationState) return;

    const target = this.navigationState.breadcrumbs[level];
    if (!target) return;

    // Truncate breadcrumbs
    this.navigationState.breadcrumbs = this.navigationState.breadcrumbs.slice(0, level + 1);
    this.loadFeed(target.feedUrl);
  }

  private renderPagination(feed: OPDSFeed): void {
    const hasNext = !!this.opdsClient.getNextPageLink(feed);
    const hasPrev = this.navigationState && this.navigationState.breadcrumbs.length > 1;

    this.elements.paginationPrev.disabled = !hasPrev;
    this.elements.paginationNext.disabled = !hasNext;

    let info = "";
    if (feed.totalResults !== undefined) {
      const start = feed.startIndex ?? 1;
      const end = Math.min(start + (feed.entries.length || 0) - 1, feed.totalResults);
      info = `Showing ${start}–${end} of ${feed.totalResults}`;
    }
    this.elements.paginationInfo.textContent = info;
  }

  private renderFacets(feed: OPDSFeed): void {
    if (!feed.facets || feed.facets.length === 0) return;
    // Facets could be rendered as filter chips - omitted for brevity
  }

  private showEntryDetails(entry: OPDSEntry): void {
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
        <button class="btn btn-primary modal-close">Close</button>
      </div>
    `;
    modal.querySelector(".modal-close")?.addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  }

  private showAddCatalogModal(): void {
    this.elements.addCatalogModal.classList.remove("hidden");
    (this.elements.addCatalogModal.querySelector("input[name='name']") as HTMLInputElement)?.focus();
  }

  private hideAddCatalogModal(): void {
    this.elements.addCatalogModal.classList.add("hidden");
    this.elements.addCatalogForm.reset();
  }

  private async addCatalog(): Promise<void> {
    const formData = new FormData(this.elements.addCatalogForm);
    const name = formData.get("name") as string;
    const url = formData.get("url") as string;
    const description = formData.get("description") as string;
    const authType = formData.get("authType") as "none" | "basic" | "bearer";
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;
    const token = formData.get("token") as string;

    if (!name || !url) {
      alert("Name and URL are required");
      return;
    }

    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    const catalog: OPDSCatalog = {
      id,
      name,
      url,
      description: description || undefined,
      auth:
        authType !== "none"
          ? {
              type: authType,
              username: username || undefined,
              password: password || undefined,
              token: token || undefined,
            }
          : undefined,
    };

    try {
      await invoke("add_catalog", { catalog });
      this.catalogs.push(catalog);
      this.renderCatalogList();
      this.hideAddCatalogModal();
    } catch (err) {
      console.error("Failed to add catalog:", err);
      alert(`Failed to add catalog: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async deleteCatalog(catalogId: string): Promise<void> {
    if (!confirm("Delete this catalog?")) return;

    try {
      await invoke("delete_catalog", { catalogId });
      this.catalogs = this.catalogs.filter((c) => c.id !== catalogId);
      this.renderCatalogList();
    } catch (err) {
      console.error("Failed to delete catalog:", err);
      alert(`Failed to delete catalog: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private showView(mode: "catalogs" | "feed"): void {
    const isCatalogs = mode === "catalogs";
    this.elements.catalogList.closest("section")!.classList.toggle("hidden", !isCatalogs);
    this.elements.feedView.classList.toggle("hidden", isCatalogs);
  }

  private showLoading(show: boolean): void {
    this.elements.feedLoading.classList.toggle("hidden", !show);
    this.elements.feedList.classList.toggle("hidden", show);
    this.elements.paginationPrev.disabled = show;
    this.elements.paginationNext.disabled = show;
  }

  private showError(message: string): void {
    this.elements.feedError.textContent = message;
    this.elements.feedError.classList.remove("hidden");
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

  destroy(): void {
    this.abortController?.abort();
  }
}