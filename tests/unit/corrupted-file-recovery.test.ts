import { describe, it, expect, beforeEach, vi } from "vitest";
import { LibraryController, type LibraryUiElements } from "../../src/features/library/library-controller.ts";
import type { Book, BookRepository, ProgressRepository } from "../../src/domain/database.ts";
import type { ReaderViewController, ReaderViewElements } from "../../src/features/reader/reader-view.ts";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

describe("Milestone M13: Corrupted & Missing File Recovery UX", () => {
  let elements: LibraryUiElements;
  let bookRepo: BookRepository;
  let progressRepo: ProgressRepository;
  let mockReaderController: { openBook: ReturnType<typeof vi.fn> };
  let mockReaderElements: Record<string, unknown>;
  let onRedownloadBook: ReturnType<typeof vi.fn>;
  let onError: ReturnType<typeof vi.fn>;
  let controller: LibraryController;

  const sampleBookWithUrl: Book = {
    id: "sample-corrupt-1",
    title: "Moby Dick",
    authors: "Herman Melville",
    coverUrl: "http://example.com/cover.jpg",
    localPath: "/app/books/sample-corrupt-1/book.epub",
    fileSize: 1024,
    downloadedAt: "2026-10-01T12:00:00Z",
    sourceId: "catalog-1",
    acquisitionUrl: "https://standardebooks.org/ebooks/herman-melville/moby-dick/downloads/moby-dick.epub",
  };

  const sampleBookWithoutUrl: Book = {
    id: "sample-corrupt-2",
    title: "Local Sideload Book",
    authors: "Unknown Author",
    coverUrl: null,
    localPath: "/app/books/sample-corrupt-2/book.epub",
    fileSize: 2048,
    downloadedAt: "2026-10-01T12:00:00Z",
    sourceId: null,
    acquisitionUrl: null,
  };

  beforeEach(() => {
    mockInvoke.mockReset();
    vi.stubGlobal("confirm", vi.fn(() => true));

    // Construct DOM elements for library view and recovery modal
    const container = document.createElement("div");
    const list = document.createElement("div");
    const emptyState = document.createElement("div");
    const sortSelect = document.createElement("select");
    const refreshBtn = document.createElement("button");

    const recoveryModal = document.createElement("div");
    recoveryModal.id = "book-recovery-modal";
    recoveryModal.className = "modal-backdrop hidden";

    const recoveryTitle = document.createElement("h3");
    recoveryTitle.id = "recovery-title";
    recoveryModal.appendChild(recoveryTitle);

    const recoveryMessage = document.createElement("p");
    recoveryMessage.id = "recovery-message";
    recoveryModal.appendChild(recoveryMessage);

    const recoveryErrorDetail = document.createElement("div");
    recoveryErrorDetail.id = "recovery-error-detail";
    recoveryErrorDetail.className = "recovery-error-detail hidden";
    recoveryModal.appendChild(recoveryErrorDetail);

    const btnRecoveryRedownload = document.createElement("button");
    btnRecoveryRedownload.id = "btn-recovery-redownload";
    btnRecoveryRedownload.className = "btn hidden";
    recoveryModal.appendChild(btnRecoveryRedownload);

    const btnRecoveryDelete = document.createElement("button");
    btnRecoveryDelete.id = "btn-recovery-delete";
    btnRecoveryDelete.className = "btn";
    recoveryModal.appendChild(btnRecoveryDelete);

    const btnRecoveryDismiss = document.createElement("button");
    btnRecoveryDismiss.id = "btn-recovery-dismiss";
    btnRecoveryDismiss.className = "btn";
    recoveryModal.appendChild(btnRecoveryDismiss);

    elements = {
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

    bookRepo = {
      findAll: vi.fn().mockResolvedValue([sampleBookWithUrl, sampleBookWithoutUrl]),
      findById: vi.fn().mockImplementation((id: string) => {
        if (id === sampleBookWithUrl.id) return Promise.resolve(sampleBookWithUrl);
        if (id === sampleBookWithoutUrl.id) return Promise.resolve(sampleBookWithoutUrl);
        return Promise.resolve(null);
      }),
      insert: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      updateLastOpened: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(2),
    } as unknown as BookRepository;

    progressRepo = {
      findByBookId: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProgressRepository;

    mockReaderController = {
      openBook: vi.fn().mockResolvedValue(undefined),
    };
    mockReaderElements = {};

    onRedownloadBook = vi.fn();
    onError = vi.fn();

    controller = new LibraryController(
      elements,
      bookRepo,
      progressRepo,
      mockReaderController as unknown as ReaderViewController,
      mockReaderElements as unknown as ReaderViewElements,
      {
        onRedownloadBook,
        onError,
      },
    );
  });

  it("handles missing book file (ENOENT): marks card as missing and displays recovery modal", async () => {
    // When read_book_file fails with file not found
    mockInvoke.mockRejectedValueOnce(new Error("ENOENT: file not found at /app/books/sample-corrupt-1/book.epub"));

    await expect(controller.openBook(sampleBookWithUrl.id)).rejects.toThrow("ENOENT");

    expect(elements.recoveryModal?.classList.contains("hidden")).toBe(false);
    expect(elements.recoveryTitle?.textContent).toBe("Book File Missing");
    expect(elements.recoveryMessage?.textContent).toContain("Moby Dick");
    expect(elements.recoveryErrorDetail?.textContent).toContain("ENOENT: file not found");
    expect(elements.recoveryErrorDetail?.classList.contains("hidden")).toBe(false);

    // Re-download button should be available because sampleBookWithUrl has acquisitionUrl
    expect(elements.btnRecoveryRedownload?.classList.contains("hidden")).toBe(false);
  });

  it("handles corrupted book file: shows corrupted error dialog with error details", async () => {
    // File read succeeds, but reader parser rejects corrupted EPUB content
    mockInvoke.mockResolvedValueOnce(new ArrayBuffer(50));
    mockReaderController.openBook.mockRejectedValueOnce(
      new Error("Invalid EPUB: OEBPS/content.opf descriptor missing or corrupted"),
    );

    await expect(controller.openBook(sampleBookWithUrl.id)).rejects.toThrow("Invalid EPUB");

    expect(elements.recoveryModal?.classList.contains("hidden")).toBe(false);
    expect(elements.recoveryTitle?.textContent).toBe("Corrupted or Unreadable Book");
    expect(elements.recoveryMessage?.textContent).toContain("corrupted or unreadable");
    expect(elements.recoveryErrorDetail?.textContent).toContain("Invalid EPUB");
  });

  it("offers Re-download option when book has acquisitionUrl and triggers callback", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("File not found"));

    await expect(controller.openBook(sampleBookWithUrl.id)).rejects.toThrow();

    expect(elements.btnRecoveryRedownload?.classList.contains("hidden")).toBe(false);

    // Clicking re-download triggers onRedownloadBook and closes modal
    elements.btnRecoveryRedownload?.click();

    expect(onRedownloadBook).toHaveBeenCalledTimes(1);
    expect(onRedownloadBook).toHaveBeenCalledWith(sampleBookWithUrl);
    expect(elements.recoveryModal?.classList.contains("hidden")).toBe(true);
  });

  it("hides Re-download button when book does NOT have acquisitionUrl", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("ENOENT: file missing"));

    await expect(controller.openBook(sampleBookWithoutUrl.id)).rejects.toThrow();

    expect(elements.recoveryModal?.classList.contains("hidden")).toBe(false);
    expect(elements.btnRecoveryRedownload?.classList.contains("hidden")).toBe(true);
  });

  it("allows removing/deleting the book from recovery modal", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Corrupted file"));

    await expect(controller.openBook(sampleBookWithUrl.id)).rejects.toThrow();

    mockInvoke.mockResolvedValueOnce(true); // delete_book_file

    // Click remove and wait for async deletion to complete
    elements.btnRecoveryDelete?.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify modal is dismissed
    expect(elements.recoveryModal?.classList.contains("hidden")).toBe(true);

    // Verify book deletion was invoked
    expect(mockInvoke).toHaveBeenCalledWith("delete_book_file", { bookId: sampleBookWithUrl.id });
    expect(bookRepo.delete).toHaveBeenCalledWith(sampleBookWithUrl.id);
  });

  it("allows dismissing the recovery modal without removing or re-downloading", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Read failure"));

    await expect(controller.openBook(sampleBookWithUrl.id)).rejects.toThrow();

    expect(elements.recoveryModal?.classList.contains("hidden")).toBe(false);

    // Click cancel/dismiss
    elements.btnRecoveryDismiss?.click();

    expect(elements.recoveryModal?.classList.contains("hidden")).toBe(true);
    expect(onRedownloadBook).not.toHaveBeenCalled();
    expect(bookRepo.delete).not.toHaveBeenCalled();
  });
});
