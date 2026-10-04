import { describe, it, expect, vi, beforeEach } from "vitest";
import { TauriDownloadService } from "../../src/services/downloads/download-service.ts";
import type { DownloadProgress, DownloadRequest, DownloadResult } from "../../src/domain/downloads.ts";

let eventHandler: ((event: { payload: DownloadProgress }) => void) | null = null;
const mockInvoke = vi.fn();
const mockListen = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: (event: { payload: DownloadProgress }) => void) => {
    mockListen(event, handler);
    eventHandler = handler;
    return Promise.resolve(() => {
      eventHandler = null;
    });
  },
}));

describe("TauriDownloadService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventHandler = null;
  });

  it("calls download_book IPC command with formatted request", async () => {
    const service = new TauriDownloadService();
    const mockResult: DownloadResult = {
      bookId: "book-uuid-1",
      localPath: "/app/books/book-uuid-1/book.epub",
      fileSize: 12345,
    };
    mockInvoke.mockResolvedValueOnce(mockResult);

    const request: DownloadRequest = {
      bookId: "book-uuid-1",
      url: "https://example.com/book.epub",
      title: "Sample Book",
      expectedSize: 12345,
    };

    const result = await service.downloadBook(request);
    expect(result).toEqual(mockResult);
    expect(mockInvoke).toHaveBeenCalledWith("download_book", {
      request: {
        bookId: "book-uuid-1",
        url: "https://example.com/book.epub",
        headers: null,
        expectedSize: 12345,
      },
    });

    service.destroy();
  });

  it("calls cancel_download IPC command", async () => {
    const service = new TauriDownloadService();
    mockInvoke.mockResolvedValueOnce(true);

    const cancelled = await service.cancelDownload("book-uuid-1");
    expect(cancelled).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("cancel_download", {
      bookId: "book-uuid-1",
    });

    service.destroy();
  });

  it("calls get_download_status IPC command", async () => {
    const service = new TauriDownloadService();
    const mockStatus: DownloadProgress = {
      bookId: "book-uuid-1",
      status: "downloading",
      bytesDownloaded: 500,
      totalBytes: 1000,
      progress: 0.5,
    };
    mockInvoke.mockResolvedValueOnce(mockStatus);

    const status = await service.getDownloadStatus("book-uuid-1");
    expect(status).toEqual(mockStatus);
    expect(mockInvoke).toHaveBeenCalledWith("get_download_status", {
      bookId: "book-uuid-1",
    });

    service.destroy();
  });

  it("dispatches progress events to registered listeners", async () => {
    const service = new TauriDownloadService();
    // Allow microtasks for async initIpcListener to settle
    await Promise.resolve();

    const progressLogs: DownloadProgress[] = [];
    const unsubscribe = service.onProgress((progress) => {
      progressLogs.push(progress);
    });

    expect(eventHandler).toBeDefined();

    const payload: DownloadProgress = {
      bookId: "book-uuid-1",
      status: "downloading",
      bytesDownloaded: 250,
      totalBytes: 1000,
      progress: 0.25,
    };

    eventHandler?.({ payload });
    expect(progressLogs).toHaveLength(1);
    expect(progressLogs[0].bytesDownloaded).toBe(250);

    unsubscribe();

    // After unsubscription, no further events received
    eventHandler?.({
      payload: {
        ...payload,
        bytesDownloaded: 500,
      },
    });
    expect(progressLogs).toHaveLength(1);

    service.destroy();
  });
});
