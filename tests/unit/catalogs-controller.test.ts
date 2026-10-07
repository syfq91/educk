import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CatalogsController, type CatalogsUiElements } from "../../src/features/catalogs/catalogs-controller.ts";
import type { OPDSFeed } from "../../src/domain/opds.ts";
import { OPDSAuthError } from "../../src/domain/opds.ts";
import type { BookRepository, SourceRepository, CatalogSource } from "../../src/domain/database.ts";
import type { DownloadService } from "../../src/domain/downloads.ts";

function createMockFeed(overrides: Partial<OPDSFeed> = {}): OPDSFeed {
  return {
    id: "feed-1",
    title: "Test OPDS Feed",
    updated: "2024-01-01T00:00:00Z",
    authors: [{ name: "Test Catalog Author" }],
    links: [
      { rel: "self", href: "https://example.com/opds" },
      { rel: "next", href: "https://example.com/opds?page=2" },
      { rel: "search", href: "https://example.com/opds/search?q={searchTerms}" },
    ],
    entries: [
      {
        id: "book-1",
        title: "Test Book 1",
        updated: "2024-01-01T00:00:00Z",
        published: "2020-01-01",
        authors: [{ name: "Alice Writer" }],
        categories: [{ term: "fiction", label: "Fiction" }],
        links: [
          { rel: "http://opds-spec.org/image", href: "https://example.com/cover1.jpg" },
          { rel: "http://opds-spec.org/acquisition/open-access", href: "https://example.com/book1.epub", type: "application/epub+zip" },
        ],
      },
      {
        id: "book-2",
        title: "Test Book 2",
        updated: "2024-01-01T00:00:00Z",
        published: "2021-01-01",
        authors: [{ name: "Bob Thinker" }],
        categories: [{ term: "philosophy", label: "Philosophy" }],
        links: [
          { rel: "http://opds-spec.org/image", href: "https://example.com/cover2.jpg" },
          { rel: "http://opds-spec.org/acquisition/open-access", href: "https://example.com/book2.epub", type: "application/epub+zip" },
        ],
      },
    ],
    facets: [
      {
        name: "Genre",
        values: [
          { value: "Fiction", label: "Fiction", count: 12 },
          { value: "Philosophy", label: "Philosophy", count: 8 },
        ],
      },
    ],
    totalResults: 50,
    ...overrides,
  };
}

describe("Milestone M8: CatalogsController", () => {
  let elements: CatalogsUiElements;
  let mockDownloadService: DownloadService;
  let mockBookRepo: BookRepository;
  let mockSourceRepo: SourceRepository;
  let storedSources: CatalogSource[];
  let controller: CatalogsController;

  beforeEach(() => {
    const store = new Map<string, string>();
    const mockLocalStorage = {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, val: string) => { store.set(key, String(val)); }),
      removeItem: vi.fn((key: string) => { store.delete(key); }),
      clear: vi.fn(() => { store.clear(); }),
    };
    vi.stubGlobal("localStorage", mockLocalStorage);
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("alert", vi.fn());

    storedSources = [];

    mockSourceRepo = {
      findById: vi.fn(async (id: string) => storedSources.find((s) => s.id === id) ?? null),
      findByUrl: vi.fn(async (url: string) => storedSources.find((s) => s.url === url) ?? null),
      findAll: vi.fn(async () => [...storedSources]),
      insert: vi.fn(async (source: CatalogSource) => {
        storedSources.push(source);
      }),
      update: vi.fn(async (source: CatalogSource) => {
        const idx = storedSources.findIndex((s) => s.id === source.id);
        if (idx >= 0) storedSources[idx] = source;
      }),
      delete: vi.fn(async (id: string) => {
        storedSources = storedSources.filter((s) => s.id !== id);
      }),
    };

    mockBookRepo = {
      findById: vi.fn().mockResolvedValue(null),
      findAll: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      updateLastOpened: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as BookRepository;

    mockDownloadService = {
      downloadBook: vi.fn().mockResolvedValue({
        bookId: "test-id",
        status: "completed",
        bytesDownloaded: 1000,
        totalBytes: 1000,
      }),
      cancelDownload: vi.fn().mockResolvedValue(undefined),
      getDownloadStatus: vi.fn().mockResolvedValue(null),
    } as unknown as DownloadService;

    // DOM setup
    const section = document.createElement("section");
    section.id = "view-catalogs";

    const container = section;
    const catalogList = document.createElement("div");
    catalogList.id = "catalog-list";
    section.appendChild(catalogList);

    const feedView = document.createElement("div");
    feedView.id = "feed-view";
    feedView.classList.add("hidden");

    const feedBreadcrumb = document.createElement("div");
    feedBreadcrumb.id = "feed-breadcrumb";
    feedView.appendChild(feedBreadcrumb);

    const feedTitle = document.createElement("h3");
    feedTitle.id = "feed-title";
    feedView.appendChild(feedTitle);

    const searchInput = document.createElement("input");
    searchInput.id = "feed-search-input";
    searchInput.type = "search";
    const searchBtn = document.createElement("button");
    searchBtn.id = "feed-search-btn";
    const searchSuggestions = document.createElement("div");
    searchSuggestions.id = "feed-search-suggestions";
    searchSuggestions.classList.add("hidden");
    feedView.appendChild(searchInput);
    feedView.appendChild(searchBtn);
    feedView.appendChild(searchSuggestions);

    const facetsContainer = document.createElement("div");
    facetsContainer.id = "feed-facets";
    facetsContainer.classList.add("hidden");
    feedView.appendChild(facetsContainer);

    const feedLoading = document.createElement("div");
    feedLoading.id = "feed-loading";
    feedLoading.classList.add("hidden");
    feedView.appendChild(feedLoading);

    const feedError = document.createElement("div");
    feedError.id = "feed-error";
    feedError.classList.add("hidden");
    feedView.appendChild(feedError);

    const feedList = document.createElement("div");
    feedList.id = "feed-list";
    feedView.appendChild(feedList);

    const scrollSentinel = document.createElement("div");
    scrollSentinel.id = "feed-scroll-sentinel";
    feedView.appendChild(scrollSentinel);

    const feedEmpty = document.createElement("div");
    feedEmpty.id = "feed-empty";
    feedEmpty.classList.add("hidden");
    const emptyBackBtn = document.createElement("button");
    emptyBackBtn.id = "btn-feed-empty-back";
    feedEmpty.appendChild(emptyBackBtn);
    feedView.appendChild(feedEmpty);

    const paginationPrev = document.createElement("button");
    paginationPrev.id = "feed-prev";
    const paginationNext = document.createElement("button");
    paginationNext.id = "feed-next";
    const paginationInfo = document.createElement("span");
    paginationInfo.id = "feed-page-info";
    feedView.appendChild(paginationPrev);
    feedView.appendChild(paginationNext);
    feedView.appendChild(paginationInfo);

    section.appendChild(feedView);

    const addCatalogBtn = document.createElement("button");
    addCatalogBtn.id = "btn-add-catalog";
    const addCatalogModal = document.createElement("div");
    addCatalogModal.id = "add-catalog-modal";
    addCatalogModal.classList.add("hidden");
    const addCatalogForm = document.createElement("form");
    addCatalogForm.id = "add-catalog-form";
    const nameInput = document.createElement("input");
    nameInput.name = "name";
    const urlInput = document.createElement("input");
    urlInput.name = "url";
    addCatalogForm.appendChild(nameInput);
    addCatalogForm.appendChild(urlInput);
    addCatalogModal.appendChild(addCatalogForm);

    const exportOpmlBtn = document.createElement("button");
    exportOpmlBtn.id = "btn-export-opml";
    const importOpmlBtn = document.createElement("button");
    importOpmlBtn.id = "btn-import-opml";
    const opmlFileInput = document.createElement("input");
    opmlFileInput.id = "opml-file-input";
    opmlFileInput.type = "file";

    const viewGridBtn = document.createElement("button");
    viewGridBtn.id = "btn-view-grid";
    const viewListBtn = document.createElement("button");
    viewListBtn.id = "btn-view-list";

    const authModal = document.createElement("div");
    authModal.id = "feed-auth-modal";
    authModal.classList.add("hidden");
    const authForm = document.createElement("form");
    authForm.id = "feed-auth-form";
    const authMessage = document.createElement("p");
    authMessage.id = "feed-auth-message";
    authModal.appendChild(authMessage);
    authModal.appendChild(authForm);

    document.body.appendChild(section);
    document.body.appendChild(addCatalogModal);
    document.body.appendChild(authModal);

    elements = {
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
  });

  afterEach(() => {
    controller?.destroy();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("should seed default catalogs into SQLite when SourceRepository is empty", async () => {
    controller = new CatalogsController(elements, mockDownloadService, mockBookRepo, mockSourceRepo);
    await new Promise((r) => setTimeout(r, 10));

    expect(mockSourceRepo.insert).toHaveBeenCalledTimes(3);
    const catalogs = controller.getCatalogs();
    expect(catalogs).toHaveLength(3);
    expect(catalogs.map((c) => c.name)).toEqual([
      "Standard Ebooks",
      "Project Gutenberg",
      "Feedbooks",
    ]);

    const cards = elements.catalogList.querySelectorAll(".catalog-card");
    expect(cards.length).toBe(3);
  });

  it("should load existing catalogs from SourceRepository without re-seeding", async () => {
    storedSources = [
      {
        id: "my-custom-feed",
        name: "My Custom Feed",
        url: "https://custom.org/opds",
        description: "Custom books",
        username: null,
        authType: "none",
        authData: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ];

    controller = new CatalogsController(elements, mockDownloadService, mockBookRepo, mockSourceRepo);
    await new Promise((r) => setTimeout(r, 10));

    expect(mockSourceRepo.insert).not.toHaveBeenCalled();
    const catalogs = controller.getCatalogs();
    expect(catalogs).toHaveLength(1);
    expect(catalogs[0].name).toBe("My Custom Feed");
  });

  it("should add a new catalog and persist to SourceRepository", async () => {
    controller = new CatalogsController(elements, mockDownloadService, mockBookRepo, mockSourceRepo);
    await new Promise((r) => setTimeout(r, 10));

    await controller.addCatalog({
      id: "manybooks",
      name: "ManyBooks",
      url: "https://manybooks.net/opds/index.php",
      description: "Free ebooks for your reader",
    });

    expect(mockSourceRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ManyBooks",
        url: "https://manybooks.net/opds/index.php",
      }),
    );

    const catalogs = controller.getCatalogs();
    expect(catalogs.some((c) => c.name === "ManyBooks")).toBe(true);
  });

  it("should delete a catalog and remove it from SourceRepository", async () => {
    controller = new CatalogsController(elements, mockDownloadService, mockBookRepo, mockSourceRepo);
    await new Promise((r) => setTimeout(r, 10));

    await controller.deleteCatalog("standardebooks");

    expect(mockSourceRepo.delete).toHaveBeenCalledWith("standardebooks");
    const catalogs = controller.getCatalogs();
    expect(catalogs.some((c) => c.id === "standardebooks")).toBe(false);
  });

  it("should toggle between grid and list views and persist preference", async () => {
    controller = new CatalogsController(elements, mockDownloadService, mockBookRepo, mockSourceRepo);
    await new Promise((r) => setTimeout(r, 10));

    // Default view mode
    expect(controller.getViewMode()).toBe("grid");

    // Toggle to list
    controller.setViewMode("list");
    expect(controller.getViewMode()).toBe("list");
    expect(elements.feedList.classList.contains("view-list")).toBe(true);
    expect(elements.viewListBtn?.classList.contains("active")).toBe(true);
    expect(localStorage.getItem("educk_catalog_view_mode")).toBe("list");

    // Toggle to grid
    controller.setViewMode("grid");
    expect(controller.getViewMode()).toBe("grid");
    expect(elements.feedList.classList.contains("view-grid")).toBe(true);
    expect(elements.viewGridBtn?.classList.contains("active")).toBe(true);
    expect(localStorage.getItem("educk_catalog_view_mode")).toBe("grid");
  });

  it("should export catalogs to OPML XML", async () => {
    controller = new CatalogsController(elements, mockDownloadService, mockBookRepo, mockSourceRepo);
    await new Promise((r) => setTimeout(r, 10));

    const opml = controller.exportOPML();
    expect(opml).toContain("<opml version=\"2.0\">");
    expect(opml).toContain("Standard Ebooks");
    expect(opml).toContain("https://standardebooks.org/opds");
  });

  it("should import catalogs from OPML without adding duplicates", async () => {
    controller = new CatalogsController(elements, mockDownloadService, mockBookRepo, mockSourceRepo);
    await new Promise((r) => setTimeout(r, 10));

    const opmlXml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="Standard Ebooks" url="https://standardebooks.org/opds" />
    <outline text="Open Library" url="https://openlibrary.org/opds" description="Internet Archive Open Library" />
  </body>
</opml>`;

    const count = await controller.importOPML(opmlXml);
    // Standard Ebooks was already present, so only Open Library should be added
    expect(count).toBe(1);

    const catalogs = controller.getCatalogs();
    expect(catalogs.some((c) => c.name === "Open Library")).toBe(true);
  });

  it("should render and filter feed entries by facets", async () => {
    const feed = createMockFeed();

    controller = new CatalogsController(elements, mockDownloadService, mockBookRepo, mockSourceRepo);
    await controller.loadCatalogs();
    // Mock opdsClient.fetchFeed
    (controller as any).opdsClient.fetchFeed = vi.fn().mockResolvedValue(feed);

    await controller.openCatalog("standardebooks");

    // Facet chips should be rendered
    expect(elements.facetsContainer?.classList.contains("hidden")).toBe(false);
    const chips = elements.facetsContainer?.querySelectorAll(".facet-chip");
    expect(chips?.length).toBeGreaterThan(0);

    // Initial entries rendered
    let cards = elements.feedList.querySelectorAll(".entry-card");
    expect(cards.length).toBe(2);

    // Click Fiction facet chip
    const fictionChip = Array.from(chips ?? []).find(
      (c) => (c as HTMLButtonElement).dataset.facetValue === "Fiction",
    ) as HTMLButtonElement;
    fictionChip?.click();

    cards = elements.feedList.querySelectorAll(".entry-card");
    expect(cards.length).toBe(1);
    expect(cards[0].querySelector(".entry-title")?.textContent).toBe("Test Book 1");

    // Click All chip to reset
    const allChip = Array.from(elements.facetsContainer?.querySelectorAll(".facet-chip") ?? []).find(
      (c) => (c as HTMLButtonElement).dataset.facetValue === "__all__",
    ) as HTMLButtonElement;
    allChip?.click();

    cards = elements.feedList.querySelectorAll(".entry-card");
    expect(cards.length).toBe(2);
  });

  it("should manage search suggestions and execute search", async () => {
    const feed = createMockFeed();
    controller = new CatalogsController(elements, mockDownloadService, mockBookRepo, mockSourceRepo);
    (controller as any).opdsClient.fetchFeed = vi.fn().mockResolvedValue(feed);

    await controller.openCatalog("standardebooks");

    // Typing in search input shows suggestions
    elements.searchInput.value = "Phil";
    controller.showSearchSuggestions("Phil");

    expect(elements.searchSuggestions?.classList.contains("hidden")).toBe(false);
    const suggestionItem = elements.searchSuggestions?.querySelector<HTMLElement>(".suggestion-item");
    expect(suggestionItem?.textContent).toContain("Philosophy");

    // Click suggestion item
    suggestionItem?.click();

    expect(elements.searchInput.value).toBe("Philosophy");
    expect(elements.searchSuggestions?.classList.contains("hidden")).toBe(true);
  });

  it("should support infinite scroll page appending", async () => {
    const page1Feed = createMockFeed({
      entries: [
        {
          id: "book-1",
          title: "Book 1",
          updated: "2024-01-01T00:00:00Z",
          authors: [{ name: "Alice" }],
          categories: [],
          links: [{ rel: "http://opds-spec.org/acquisition/open-access", href: "https://example.com/1.epub" }],
        },
      ],
      links: [{ rel: "next", href: "https://example.com/opds?page=2" }],
    });

    const page2Feed = createMockFeed({
      entries: [
        {
          id: "book-2",
          title: "Book 2",
          updated: "2024-01-01T00:00:00Z",
          authors: [{ name: "Bob" }],
          categories: [],
          links: [{ rel: "http://opds-spec.org/acquisition/open-access", href: "https://example.com/2.epub" }],
        },
      ],
      links: [],
    });

    controller = new CatalogsController(elements, mockDownloadService, mockBookRepo, mockSourceRepo);
    await controller.loadCatalogs();
    (controller as any).opdsClient.fetchFeed = vi
      .fn()
      .mockResolvedValueOnce(page1Feed)
      .mockResolvedValueOnce(page2Feed);

    await controller.openCatalog("standardebooks");

    expect(elements.feedList.querySelectorAll(".entry-card").length).toBe(1);

    // Call infinite scroll loadNextPage
    await controller.loadNextPage(true);

    expect(elements.feedList.querySelectorAll(".entry-card").length).toBe(2);
    expect(elements.paginationNext.disabled).toBe(true); // No more next page
  });

  it("should display network error with retry button and allow retrying", async () => {
    controller = new CatalogsController(elements, mockDownloadService, mockBookRepo, mockSourceRepo);
    await controller.loadCatalogs();

    // Fail first, succeed on retry
    const fetchFeedMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection refused"))
      .mockResolvedValueOnce(createMockFeed());
    (controller as any).opdsClient.fetchFeed = fetchFeedMock;

    await controller.openCatalog("standardebooks");

    expect(elements.feedError.classList.contains("hidden")).toBe(false);
    expect(elements.feedError.textContent).toContain("Connection refused");

    const retryBtn = elements.feedError.querySelector<HTMLButtonElement>(".btn-retry");
    expect(retryBtn).not.toBeNull();

    // Click retry
    retryBtn?.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(fetchFeedMock).toHaveBeenCalledTimes(2);
    expect(elements.feedError.classList.contains("hidden")).toBe(true);
    expect(elements.feedList.querySelectorAll(".entry-card").length).toBe(2);
  });

  it("should show authentication prompt modal on 401 Unauthorized", async () => {
    controller = new CatalogsController(elements, mockDownloadService, mockBookRepo, mockSourceRepo);
    await controller.loadCatalogs();

    (controller as any).opdsClient.fetchFeed = vi
      .fn()
      .mockRejectedValueOnce(new OPDSAuthError("Authentication required", "https://example.com/opds"));

    await controller.openCatalog("standardebooks");

    expect(elements.authModal?.classList.contains("hidden")).toBe(false);
  });

  it("should acquire entry and trigger book download", async () => {
    const feed = createMockFeed();
    const onDownloadStarted = vi.fn();

    controller = new CatalogsController(elements, mockDownloadService, mockBookRepo, mockSourceRepo, {
      onDownloadStarted,
    });
    await controller.loadCatalogs();
    (controller as any).opdsClient.fetchFeed = vi.fn().mockResolvedValue(feed);

    await controller.openCatalog("standardebooks");

    const acquireBtn = elements.feedList.querySelector<HTMLButtonElement>(".btn-acquire");
    expect(acquireBtn).not.toBeNull();

    acquireBtn?.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(mockDownloadService.downloadBook).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Test Book 1",
        url: "https://example.com/book1.epub",
      }),
    );
    expect(onDownloadStarted).toHaveBeenCalled();
  });
});
