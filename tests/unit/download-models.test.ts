import { describe, it, expect } from "vitest";
import type {
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  DownloadStatus,
} from "../../src/domain/downloads.ts";

describe("Download Domain Models", () => {
  it("creates a valid DownloadRequest", () => {
    const request: DownloadRequest = {
      bookId: "c9bf9e57-1685-4c89-bafb-ff5af830be8a",
      url: "https://example.com/books/sample.epub",
      title: "Moby Dick",
      authors: "Herman Melville",
      expectedSize: 1048576,
      headers: {
        Authorization: "Bearer test-token",
      },
    };

    expect(request.bookId).toBe("c9bf9e57-1685-4c89-bafb-ff5af830be8a");
    expect(request.title).toBe("Moby Dick");
    expect(request.headers?.Authorization).toBe("Bearer test-token");
    expect(request.expectedSize).toBe(1048576);
  });

  it("handles all DownloadStatus variations", () => {
    const statuses: DownloadStatus[] = [
      "idle",
      "downloading",
      "verifying",
      "completed",
      "failed",
      "cancelled",
    ];

    expect(statuses).toHaveLength(6);
  });

  it("calculates progress values and represents indeterminate downloads", () => {
    const determinateProgress: DownloadProgress = {
      bookId: "book-1",
      status: "downloading",
      bytesDownloaded: 500,
      totalBytes: 1000,
      progress: 0.5,
    };

    expect(determinateProgress.progress).toBe(0.5);
    expect(determinateProgress.bytesDownloaded).toBe(500);

    const indeterminateProgress: DownloadProgress = {
      bookId: "book-2",
      status: "downloading",
      bytesDownloaded: 2048,
      totalBytes: null,
      progress: -1.0,
    };

    expect(indeterminateProgress.progress).toBe(-1.0);
    expect(indeterminateProgress.totalBytes).toBeNull();
  });

  it("encapsulates DownloadResult with local path and file size", () => {
    const result: DownloadResult = {
      bookId: "book-123",
      localPath: "/data/user/0/my.syfq91.educk/files/books/book-123/book.epub",
      fileSize: 45000,
    };

    expect(result.localPath).toContain("book-123/book.epub");
    expect(result.fileSize).toBe(45000);
  });
});
