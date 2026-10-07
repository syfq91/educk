import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LibraryController } from "../../src/features/library/library-controller.ts";
import type { Book, BookRepository, ProgressRepository, ReadingProgress } from "../../src/domain/database.ts";
import type { ReadingPosition } from "../../src/domain/reader.ts";

// Mock repositories
const createMockBookRepo = (books: Book[] = []) => ({
  findAll: vi.fn().mockResolvedValue(books),
  findById: vi.fn().mockImplementation((id: string) => Promise.resolve(books.find(b => b.id === id) ?? null)),
  insert: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue(undefined),
  updateLastOpened: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  count: vi.fn().mockResolvedValue(books.length),
}) as unknown as BookRepository;

const createMockProgressRepo = (progressMap: Map<string, ReadingProgress> = new Map()) => ({
  findByBookId: vi.fn().mockImplementation((id: string) => Promise.resolve(progressMap.get(id) ?? null)),
  upsert: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
}) as unknown as ProgressRepository;

// Mock ReaderViewController
const createMockReaderController = () => ({
  openBook: vi.fn().mockResolvedValue(undefined),
}) as any;

// Mock ReaderViewElements
const createMockReaderElements = () => ({}) as any;

describe("Milestone M6: LibraryController", () => {
  let container: HTMLElement;
  let list: HTMLElement;
  let emptyState: HTMLElement;
  let sortSelect: HTMLSelectElement;
  let refreshBtn: HTMLButtonElement;
  let bookRepo: BookRepository;
  let progressRepo: ProgressRepository;
  let readerController: any;
  let readerElements: any;
  let controller: LibraryController;

  beforeEach(() => {
    container = document.createElement("div");
    container.id = "view-library";

    list = document.createElement("div");
    list.id = "library-list";

    emptyState = document.createElement("div");
    emptyState.id = "library-empty";
    emptyState.className = "empty-state hidden";
    emptyState.innerHTML = `<div class="empty-icon">📚</div><h2>Your Library is Empty</h2><p>Download books from OPDS catalogs or use the download button above to add your first book.</p>`;

    sortSelect = document.createElement("select");
    sortSelect.id = "library-sort";
    sortSelect.innerHTML = `
      <option value="last_opened">Recently Read</option>
      <option value="title">Title (A-Z)</option>
      <option value="downloaded_at">Download Date</option>
    `;

    refreshBtn = document.createElement("button");
    refreshBtn.id = "library-refresh";
    refreshBtn.className = "btn btn-secondary btn-sm";
    refreshBtn.textContent = "⟳";

    container.appendChild(list);
    container.appendChild(emptyState);
    container.appendChild(sortSelect);
    container.appendChild(refreshBtn);
    document.body.appendChild(container);

    bookRepo = createMockBookRepo();
    progressRepo = createMockProgressRepo();
    readerController = createMockReaderController();
    readerElements = createMockReaderElements();

    controller = new LibraryController(
      { container, list, emptyState, sortSelect, refreshBtn },
      bookRepo,
      progressRepo,
      readerController,
      readerElements,
    );
  });

  afterEach(() => {
    controller.destroy();
    container.remove();
    vi.clearAllMocks();
  });

  it("should initialize with empty state visible when no books", async () => {
    // The constructor calls loadBooks automatically
    await new Promise(r => setTimeout(r, 10)); // Wait for async loadBooks

    expect(emptyState.classList.contains("hidden")).toBe(false);
    expect(list.classList.contains("hidden")).toBe(true);
    expect(list.innerHTML).toBe("");
  });

  it("should render book cards when books exist", async () => {
    const books: Book[] = [
      {
        id: "book-1",
        title: "Test Book 1",
        authors: "Author One",
        acquisitionUrl: "https://example.com/book1.epub",
        mimeType: "application/epub+zip",
        localPath: "books/book-1/book.epub",
        fileSize: 100000,
        downloadedAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      },
      {
        id: "book-2",
        title: "Test Book 2",
        authors: "Author Two",
        acquisitionUrl: "https://example.com/book2.epub",
        mimeType: "application/epub+zip",
        localPath: "books/book-2/book.epub",
        fileSize: 200000,
        downloadedAt: new Date().toISOString(),
      },
    ];

    bookRepo = createMockBookRepo(books);
    controller = new LibraryController(
      { container, list, emptyState, sortSelect, refreshBtn },
      bookRepo,
      progressRepo,
      readerController,
      readerElements,
    );

    await new Promise(r => setTimeout(r, 10));

    expect(emptyState.classList.contains("hidden")).toBe(true);
    expect(list.classList.contains("hidden")).toBe(false);
    expect(list.querySelectorAll(".book-card").length).toBe(2);
    expect(list.textContent).toContain("Test Book 1");
    expect(list.textContent).toContain("Test Book 2");
    expect(list.textContent).toContain("Author One");
    expect(list.textContent).toContain("Author Two");
  });

  it("should show reading progress when available", async () => {
    const books: Book[] = [{
      id: "book-1",
      title: "Test Book",
      authors: "Author",
      acquisitionUrl: "https://example.com/book.epub",
      mimeType: "application/epub+zip",
      localPath: "books/book-1/book.epub",
      fileSize: 100000,
      downloadedAt: new Date().toISOString(),
    }];

    const progressMap = new Map<string, ReadingProgress>([
      ["book-1", {
        bookId: "book-1",
        progression: 0.5,
        locator: "epubcfi(/6/4!/4/2/10)",
        href: "ch1.xhtml",
        chapterTitle: "Chapter 1",
        modifiedAt: new Date().toISOString(),
      }],
    ]);

    bookRepo = createMockBookRepo(books);
    progressRepo = createMockProgressRepo(progressMap);

    controller = new LibraryController(
      { container, list, emptyState, sortSelect, refreshBtn },
      bookRepo,
      progressRepo,
      readerController,
      readerElements,
    );

    await new Promise(r => setTimeout(r, 10));

    expect(list.textContent).toContain("50% read");
    expect(list.textContent).toContain("Chapter 1");
    const progressFill = list.querySelector(".book-progress-fill");
    expect(progressFill).not.toBeNull();
    expect(progressFill?.getAttribute("style")).toContain("50%");
  });

  it("should call reader controller when opening a book", async () => {
    const books: Book[] = [{
      id: "book-1",
      title: "Test Book",
      authors: "Author",
      acquisitionUrl: "https://example.com/book.epub",
      mimeType: "application/epub+zip",
      localPath: "books/book-1/book.epub",
      fileSize: 100000,
      downloadedAt: new Date().toISOString(),
    }];

    bookRepo = createMockBookRepo(books);
    // Mock the read_book_file invoke
    vi.stubGlobal("invoke", vi.fn().mockResolvedValue(new ArrayBuffer(100)));

    controller = new LibraryController(
      { container, list, emptyState, sortSelect, refreshBtn },
      bookRepo,
      progressRepo,
      readerController,
      readerElements,
    );

    await new Promise(r => setTimeout(r, 10));

    const openBtn = list.querySelector<HTMLButtonElement>(".btn-open");
    expect(openBtn).not.toBeNull();
    openBtn?.click();

    await new Promise(r => setTimeout(r, 10));

    expect(readerController.openBook).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.objectContaining({ bookId: "book-1" })
    );
  });

  it("should sort books when sort select changes", async () => {
    const books: Book[] = [
      {
        id: "book-1",
        title: "A First Book",
        authors: "Author",
        acquisitionUrl: "https://example.com/book1.epub",
        mimeType: "application/epub+zip",
        localPath: "books/book-1/book.epub",
        fileSize: 100000,
        downloadedAt: "2024-01-01T00:00:00.000Z",
        lastOpenedAt: "2024-01-03T00:00:00.000Z",
      },
      {
        id: "book-2",
        title: "B Second Book",
        authors: "Author",
        acquisitionUrl: "https://example.com/book2.epub",
        mimeType: "application/epub+zip",
        localPath: "books/book-2/book.epub",
        fileSize: 100000,
        downloadedAt: "2024-01-02T00:00:00.000Z",
        lastOpenedAt: "2024-01-02T00:00:00.000Z",
      },
    ];

    bookRepo = createMockBookRepo(books);
    controller = new LibraryController(
      { container, list, emptyState, sortSelect, refreshBtn },
      bookRepo,
      progressRepo,
      readerController,
      readerElements,
    );

    await new Promise(r => setTimeout(r, 10));

    // Change sort to title
    sortSelect.value = "title";
    sortSelect.dispatchEvent(new Event("change"));

    await new Promise(r => setTimeout(r, 10));

    expect(bookRepo.findAll).toHaveBeenCalledWith(expect.objectContaining({ sortBy: "title" }));
  });

  it("should call delete_book_file and bookRepo.delete when deleting a book", async () => {
    const books: Book[] = [{
      id: "book-1",
      title: "Test Book",
      authors: "Author",
      acquisitionUrl: "https://example.com/book.epub",
      mimeType: "application/epub+zip",
      localPath: "books/book-1/book.epub",
      fileSize: 100000,
      downloadedAt: new Date().toISOString(),
    }];

    bookRepo = createMockBookRepo(books);
    vi.stubGlobal("invoke", vi.fn().mockResolvedValue(true));
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    controller = new LibraryController(
      { container, list, emptyState, sortSelect, refreshBtn },
      bookRepo,
      progressRepo,
      readerController,
      readerElements,
    );

    await new Promise(r => setTimeout(r, 10));

    const deleteBtn = list.querySelector<HTMLButtonElement>(".btn-delete");
    expect(deleteBtn).not.toBeNull();
    deleteBtn?.click();

    await new Promise(r => setTimeout(r, 10));

    expect(invoke).toHaveBeenCalledWith("delete_book_file", { bookId: "book-1" });
    expect(bookRepo.delete).toHaveBeenCalledWith("book-1");
  });

  it("should refresh library when refresh button clicked", async () => {
    const books: Book[] = [{
      id: "book-1",
      title: "Test Book",
      authors: "Author",
      acquisitionUrl: "https://example.com/book.epub",
      mimeType: "application/epub+zip",
      localPath: "books/book-1/book.epub",
      fileSize: 100000,
      downloadedAt: new Date().toISOString(),
    }];

    bookRepo = createMockBookRepo(books);
    controller = new LibraryController(
      { container, list, emptyState, sortSelect, refreshBtn },
      bookRepo,
      progressRepo,
      readerController,
      readerElements,
    );

    await new Promise(r => setTimeout(r, 10));

    const initialCallCount = (bookRepo.findAll as any).mock.calls.length;

    refreshBtn.click();

    await new Promise(r => setTimeout(r, 10));

    expect((bookRepo.findAll as any).mock.calls.length).toBe(initialCallCount + 1);
  });

  it("should show missing file indicator when file not found", async () => {
    const books: Book[] = [{
      id: "book-1",
      title: "Test Book",
      authors: "Author",
      acquisitionUrl: "https://example.com/book.epub",
      mimeType: "application/epub+zip",
      localPath: "books/book-1/book.epub",
      fileSize: 100000,
      downloadedAt: new Date().toISOString(),
    }];

    bookRepo = createMockBookRepo(books);
    // Mock invoke to throw file not found error
    vi.stubGlobal("invoke", vi.fn().mockRejectedValue(new Error("ENOENT: file not found")));

    controller = new LibraryController(
      { container, list, emptyState, sortSelect, refreshBtn },
      bookRepo,
      progressRepo,
      readerController,
      readerElements,
    );

    await new Promise(r => setTimeout(r, 10));

    const openBtn = list.querySelector<HTMLButtonElement>(".btn-open");
    openBtn?.click();

    await new Promise(r => setTimeout(r, 10));

    // Should show missing badge and disable open button
    const card = list.querySelector(".book-card");
    expect(card?.dataset.fileExists).toBe("false");
    expect(card?.querySelector(".missing-badge")).not.toBeNull();
    expect(openBtn?.disabled).toBe(true);
    expect(openBtn?.textContent).toBe("Unavailable");
  });
});