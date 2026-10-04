/**
 * Domain contracts and models for the Native Download Engine.
 * Strict architectural boundary: UI components use DownloadService, never raw IPC.
 */

export type DownloadStatus =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface DownloadRequest {
  bookId: string;
  url: string;
  title: string;
  subtitle?: string | null;
  authors?: string | null;
  coverUrl?: string | null;
  sourceId?: string | null;
  remoteId?: string | null;
  headers?: Record<string, string>;
  expectedSize?: number;
}

export interface DownloadProgress {
  bookId: string;
  status: DownloadStatus;
  bytesDownloaded: number;
  totalBytes?: number | null;
  progress: number; // 0.0 to 1.0, or -1.0 if indeterminate
  error?: string | null;
}

export interface DownloadResult {
  bookId: string;
  localPath: string;
  fileSize: number;
}

export interface DownloadService {
  downloadBook(request: DownloadRequest): Promise<DownloadResult>;
  cancelDownload(bookId: string): Promise<boolean>;
  getDownloadStatus(bookId: string): Promise<DownloadProgress | null>;
  onProgress(callback: (progress: DownloadProgress) => void): () => void;
}
