import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  DownloadService,
} from "../../domain/downloads.ts";

export class TauriDownloadService implements DownloadService {
  private progressListeners: Set<(progress: DownloadProgress) => void> = new Set();
  private unlistenIpc: UnlistenFn | null = null;
  private isListening = false;

  constructor() {
    this.initIpcListener().catch((err) => {
      // In web preview or node test environment, Tauri event listening is unavailable
      console.warn("Tauri event listener initialization skipped:", err);
    });
  }

  private async initIpcListener(): Promise<void> {
    if (this.isListening) return;

    try {
      this.unlistenIpc = await listen<DownloadProgress>(
        "download://progress",
        (event) => {
          for (const listener of this.progressListeners) {
            try {
              listener(event.payload);
            } catch (err) {
              console.error("Error in download progress callback:", err);
            }
          }
        },
      );
      this.isListening = true;
    } catch {
      // Not in Tauri runtime
    }
  }

  async downloadBook(request: DownloadRequest): Promise<DownloadResult> {
    return invoke<DownloadResult>("download_book", {
      request: {
        bookId: request.bookId,
        url: request.url,
        headers: request.headers ?? null,
        expectedSize: request.expectedSize ?? null,
      },
    });
  }

  async cancelDownload(bookId: string): Promise<boolean> {
    return invoke<boolean>("cancel_download", { bookId });
  }

  async getDownloadStatus(bookId: string): Promise<DownloadProgress | null> {
    return invoke<DownloadProgress | null>("get_download_status", { bookId });
  }

  onProgress(callback: (progress: DownloadProgress) => void): () => void {
    this.progressListeners.add(callback);
    return () => {
      this.progressListeners.delete(callback);
    };
  }

  destroy(): void {
    this.progressListeners.clear();
    if (this.unlistenIpc) {
      this.unlistenIpc();
      this.unlistenIpc = null;
    }
    this.isListening = false;
  }
}
