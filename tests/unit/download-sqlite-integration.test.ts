import { describe, it, expect, vi, beforeEach } from "vitest";
import { DownloadController, type DownloadUiElements } from "../../src/features/downloads/download-controller.ts";
import { SqlBookRepository } from "../../src/services/database/sql-book-repository.ts";
import { createMigratedTestDatabase } from "../helpers/test-database.ts";
import type {
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  DownloadService,
} from "../../src/domain/downloads.ts";
import type { Book } from "../../src/domain/database.ts";

class MockDownloadService implements DownloadService {
  public progressListeners: Set<(progress: DownloadProgress) => void> = new Set();
  public downloadCalls: DownloadRequest[] = [];
  public cancelCalls: string[] = [];

  async downloadBook(request: DownloadRequest): Promise<DownloadResult> {
    this.downloadCalls.push(request);
    // Emit progress
    this.emitProgress({
      bookId: request.bookId,
      status: "downloading",
      bytesDownloaded: 25000,
      totalBytes: 50000,
      progress: 0.5,
    });

    this.emitProgress({
      bookId: request.bookId,
      status: "verifying",
      bytesDownloaded: 50000,
      totalBytes: 50000,
      progress: 1.0,
    });

    const result: DownloadResult = {
      bookId: request.bookId,
      localPath: `/app-data/books/${request.bookId}/book.epub`,
      fileSize: 50000,
    };

    this.emitProgress({
      bookId: request.bookId,
      status: "completed",
      bytesDownloaded: 50000,
      totalBytes: 50000,
      progress: 1.0,
    });

    return result;
  }

  async cancelDownload(bookId: string): Promise<boolean> {
    this.cancelCalls.push(bookId);
    this.emitProgress({
      bookId,
      status: "cancelled",
      bytesDownloaded: 0,
      totalBytes: null,
      progress: 0.0,
    });
    return true;
  }

  async getDownloadStatus(_bookId: string): Promise<DownloadProgress | null> {
    return null;
  }

  onProgress(callback: (progress: DownloadProgress) => void): () => void {
    this.progressListeners.add(callback);
    return () => {
      this.progressListeners.delete(callback);
    };
  }

  emitProgress(progress: DownloadProgress): void {
    for (const listener of this.progressListeners) {
      listener(progress);
    }
  }
}

describe("DownloadController & SQLite Integration", () => {
  let db: ReturnType<typeof createMigratedTestDatabase>;
  let bookRepo: SqlBookRepository;
  let mockDownloadService: MockDownloadService;
  let elements: DownloadUiElements;

  beforeEach(() => {
    db = createMigratedTestDatabase();
    bookRepo = new SqlBookRepository(db);
    mockDownloadService = new MockDownloadService();

    // Setup DOM elements using happy-dom
    const container = document.createElement("div");
    const triggerBtn = document.createElement("button") as HTMLButtonElement;
    const cancelBtn = document.createElement("button") as HTMLButtonElement;
    const progressBar = document.createElement("div");
    const progressFill = document.createElement("div");
    const statusLabel = document.createElement("span");
    const bytesLabel = document.createElement("span");

    container.appendChild(triggerBtn);
    container.appendChild(cancelBtn);
    container.appendChild(progressBar);
    progressBar.appendChild(progressFill);
    container.appendChild(statusLabel);
    container.appendChild(bytesLabel);

    elements = {
      container,
      triggerBtn,
      cancelBtn,
      progressBar,
      progressFill,
      statusLabel,
      bytesLabel,
    };
  });

  it("completes download and writes book record to SQLite BookRepository", async () => {
    let acquiredBook: Book | null = null;
    const controller = new DownloadController(elements, mockDownloadService, bookRepo, {
      onBookAcquired: (book) => {
        acquiredBook = book;
      },
    });

    const request: DownloadRequest = {
      bookId: "c9bf9e57-1685-4c89-bafb-ff5af830be8a",
      url: "https://example.com/books/sample.epub",
      title: "Test Downloaded Book",
      authors: "Author Name",
      expectedSize: 50000,
    };

    const result = await controller.startDownload(request);

    expect(result.fileSize).toBe(50000);
    expect(acquiredBook).not.toBeNull();
    expect(acquiredBook?.id).toBe("c9bf9e57-1685-4c89-bafb-ff5af830be8a");

    // Verify stored in real SQLite database
    const stored = await bookRepo.findById("c9bf9e57-1685-4c89-bafb-ff5af830be8a");
    expect(stored).not.toBeNull();
    expect(stored?.title).toBe("Test Downloaded Book");
    expect(stored?.localPath).toBe("/app-data/books/c9bf9e57-1685-4c89-bafb-ff5af830be8a/book.epub");
    expect(stored?.fileSize).toBe(50000);
    expect(stored?.mimeType).toBe("application/epub+zip");

    // Verify UI reflects completed state
    expect(elements.statusLabel.textContent).toContain("complete");
    expect(elements.progressFill.style.width).toBe("100%");
    expect(elements.cancelBtn.disabled).toBe(true);
    expect(elements.triggerBtn.disabled).toBe(false);

    controller.destroy();
  });

  it("handles user cancellation via cancel button", async () => {
    const controller = new DownloadController(elements, mockDownloadService, bookRepo);

    // Simulate an active download in progress
    const activePromise = controller.startDownload({
      bookId: "cancel-me-book",
      url: "https://example.com/book.epub",
      title: "Cancelling Book",
    });

    // Click cancel button while active
    elements.cancelBtn.click();

    await activePromise;
    expect(mockDownloadService.cancelCalls).toContain("cancel-me-book");

    controller.destroy();
  });

  it("handles download failures and updates UI", async () => {
    const failingService = new MockDownloadService();
    failingService.downloadBook = vi.fn().mockRejectedValueOnce(new Error("Network connection dropped"));

    const controller = new DownloadController(elements, failingService, bookRepo);

    await expect(
      controller.startDownload({
        bookId: "failed-book",
        url: "https://example.com/failed.epub",
        title: "Failed Book",
      }),
    ).rejects.toThrow("Network connection dropped");

    expect(elements.statusLabel.textContent).toContain("Network connection dropped");
    expect(elements.cancelBtn.disabled).toBe(true);
    expect(elements.triggerBtn.disabled).toBe(false);

    // Verify no corrupted record was added to SQLite
    const stored = await bookRepo.findById("failed-book");
    expect(stored).toBeNull();

    controller.destroy();
  });
});
