import type {
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  DownloadService,
} from "../../domain/downloads.ts";
import type { Book, BookRepository } from "../../domain/database.ts";

export interface DownloadUiElements {
  container: HTMLElement;
  triggerBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
  progressBar: HTMLElement;
  progressFill: HTMLElement;
  statusLabel: HTMLElement;
  bytesLabel: HTMLElement;
}

export interface DownloadControllerCallbacks {
  onBookAcquired?: (book: Book) => void;
  onError?: (err: unknown) => void;
}

export class DownloadController {
  private activeBookId: string | null = null;
  private unsubscribeProgress: (() => void) | null = null;

  constructor(
    private elements: DownloadUiElements,
    private downloadService: DownloadService,
    private bookRepo: BookRepository,
    private callbacks?: DownloadControllerCallbacks,
  ) {
    this.setupListeners();
  }

  private setupListeners(): void {
    this.elements.cancelBtn.addEventListener("click", () => {
      if (this.activeBookId) {
        void this.downloadService.cancelDownload(this.activeBookId);
      }
    });

    this.unsubscribeProgress = this.downloadService.onProgress((progress) => {
      if (this.activeBookId && progress.bookId === this.activeBookId) {
        this.updateUi(progress);
      }
    });
  }

  async startDownload(request: DownloadRequest): Promise<DownloadResult> {
    this.activeBookId = request.bookId;
    this.elements.triggerBtn.disabled = true;
    this.elements.cancelBtn.disabled = false;
    this.elements.progressBar.classList.remove("hidden");
    this.elements.statusLabel.textContent = "Starting download...";
    this.elements.statusLabel.style.color = "var(--text-secondary)";
    this.elements.progressFill.style.width = "0%";
    this.elements.bytesLabel.textContent = "0 KB";

    try {
      const result = await this.downloadService.downloadBook(request);

      // Register downloaded book into SQLite BookRepository
      const bookRecord: Book = {
        id: request.bookId,
        sourceId: request.sourceId ?? null,
        remoteId: request.remoteId ?? null,
        title: request.title,
        subtitle: request.subtitle ?? null,
        authors: request.authors ?? null,
        coverUrl: request.coverUrl ?? null,
        acquisitionUrl: request.url,
        mimeType: "application/epub+zip",
        localPath: result.localPath,
        fileSize: result.fileSize,
        downloadedAt: new Date().toISOString(),
      };

      await this.bookRepo.insert(bookRecord);

      this.elements.statusLabel.textContent = "Download complete & verified!";
      this.elements.statusLabel.style.color = "var(--status-success)";
      this.elements.progressFill.style.width = "100%";
      this.elements.cancelBtn.disabled = true;
      this.elements.triggerBtn.disabled = false;
      this.activeBookId = null;

      this.callbacks?.onBookAcquired?.(bookRecord);
      return result;
    } catch (err) {
      const errMsg = String(err);
      this.elements.statusLabel.textContent = errMsg.includes("cancelled")
        ? "Download cancelled"
        : `Download failed: ${errMsg}`;
      this.elements.statusLabel.style.color = "var(--status-error)";
      this.elements.cancelBtn.disabled = true;
      this.elements.triggerBtn.disabled = false;
      this.activeBookId = null;

      this.callbacks?.onError?.(err);
      throw err;
    }
  }

  private updateUi(progress: DownloadProgress): void {
    const downloadedKb = Math.round(progress.bytesDownloaded / 1024);

    if (progress.status === "downloading") {
      if (progress.totalBytes && progress.totalBytes > 0) {
        const totalKb = Math.round(progress.totalBytes / 1024);
        const percent = Math.round((progress.progress >= 0 ? progress.progress : 0) * 100);
        this.elements.progressFill.style.width = `${percent}%`;
        this.elements.statusLabel.textContent = `Downloading (${percent}%)...`;
        this.elements.bytesLabel.textContent = `${downloadedKb} KB / ${totalKb} KB`;
      } else {
        this.elements.statusLabel.textContent = "Downloading...";
        this.elements.bytesLabel.textContent = `${downloadedKb} KB`;
      }
    } else if (progress.status === "verifying") {
      this.elements.statusLabel.textContent = "Verifying EPUB archive integrity...";
      this.elements.statusLabel.style.color = "var(--accent-primary)";
      this.elements.progressFill.style.width = "100%";
    } else if (progress.status === "completed") {
      this.elements.statusLabel.textContent = "Verified and stored!";
      this.elements.statusLabel.style.color = "var(--status-success)";
      this.elements.progressFill.style.width = "100%";
    } else if (progress.status === "cancelled") {
      this.elements.statusLabel.textContent = "Download cancelled";
      this.elements.statusLabel.style.color = "var(--text-secondary)";
    } else if (progress.status === "failed") {
      this.elements.statusLabel.textContent = progress.error ?? "Download failed";
      this.elements.statusLabel.style.color = "var(--status-error)";
    }
  }

  destroy(): void {
    if (this.unsubscribeProgress) {
      this.unsubscribeProgress();
      this.unsubscribeProgress = null;
    }
  }
}
