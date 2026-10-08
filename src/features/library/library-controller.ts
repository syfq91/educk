/**
 * LibraryController
 *
 * Manages the Offline Local Library view:
 * - Displays downloaded books from SQLite with cover, title, author, and reading progress
 * - Supports sorting (recently read, title, download date)
 * - Handles book deletion (filesystem + SQLite cascade)
 * - Manages empty states and missing file error indicators
 * - Opens books directly into ReaderViewController
 */

import { invoke } from "@tauri-apps/api/core";
import type { Book, BookQueryOptions, BookRepository, ProgressRepository, ReadingProgress as DbReadingProgress } from "../../domain/database.ts";
import type { ReadingPosition } from "../../domain/reader.ts";
import { ReaderViewController, type ReaderViewElements } from "../reader/reader-view.ts";

export interface LibraryUiElements {
  container: HTMLElement;
  list: HTMLElement;
  emptyState: HTMLElement;
  sortSelect: HTMLSelectElement;
  refreshBtn: HTMLButtonElement;
}

export interface LibraryControllerCallbacks {
  onOpenBook?: (bookId: string) => void;
  onError?: (error: Error) => void;
}

type SortOption = "last_opened" | "title" | "downloaded_at";

function mapDbProgressToPosition(progress: DbReadingProgress | null): ReadingPosition | null {
  if (!progress) return null;
  return {
    bookId: progress.bookId,
    progression: progress.progression,
    locator: progress.locator,
    href: progress.href ?? undefined,
    title: progress.chapterTitle ?? undefined,
    modifiedAt: progress.modifiedAt,
  };
}

export class LibraryController {
  private elements: LibraryUiElements;
  private bookRepo: BookRepository;
  private progressRepo: ProgressRepository;
  private readerController: ReaderViewController | null = null;
  private readerElements: ReaderViewElements | null = null;
  private callbacks: LibraryControllerCallbacks;
  private currentSort: SortOption = "last_opened";
  private currentOrder: "asc" | "desc" = "desc";

  constructor(
    elements: LibraryUiElements,
    bookRepo: BookRepository,
    progressRepo: ProgressRepository,
    readerController: ReaderViewController | null,
    readerElements: ReaderViewElements | null,
    callbacks?: LibraryControllerCallbacks,
  ) {
    this.elements = elements;
    this.bookRepo = bookRepo;
    this.progressRepo = progressRepo;
    this.readerController = readerController;
    this.readerElements = readerElements;
    this.callbacks = callbacks ?? {};
    this.bindEvents();
    this.loadBooks();
  }

  private bindEvents(): void {
    // Sort change
    this.elements.sortSelect.addEventListener("change", () => {
      const value = this.elements.sortSelect.value as SortOption;
      if (value) {
        this.currentSort = value;
        this.loadBooks();
      }
    });

    // Refresh button
    this.elements.refreshBtn.addEventListener("click", () => {
      this.loadBooks();
    });
  }

  async loadBooks(): Promise<void> {
    this.showLoading(true);

    try {
      const options: BookQueryOptions = {
        sortBy: this.currentSort,
        order: this.currentOrder,
      };

      const books = await this.bookRepo.findAll(options);
      await this.renderBooks(books);
    } catch (err) {
      console.error("Failed to load books:", err);
      this.showError("Failed to load library");
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.showLoading(false);
    }
  }

  private async renderBooks(books: Book[]): Promise<void> {
    if (books.length === 0) {
      this.showEmptyState(true);
      this.elements.list.innerHTML = "";
      return;
    }

    this.showEmptyState(false);

    // Load progress for all books
    const booksWithProgress = await Promise.all(
      books.map(async (book) => {
        const progress = await this.progressRepo.findByBookId(book.id);
        return { book, progress: mapDbProgressToPosition(progress) };
      }),
    );

    this.elements.list.innerHTML = booksWithProgress
      .map(({ book, progress }) => this.createBookCard(book, progress))
      .join("");

    // Attach event listeners
    this.attachBookCardListeners();
  }

  private createBookCard(book: Book, progress: ReadingPosition | null): string {
    const hasProgress = progress && progress.progression > 0;
    const progressPercent = hasProgress ? Math.round(progress.progression * 100) : 0;
    const progressBarWidth = hasProgress ? `${progressPercent}%` : "0%";
    const chapterTitle = progress?.title ?? "Not started";
    const lastOpened = book.lastOpenedAt
      ? this.formatRelativeTime(new Date(book.lastOpenedAt))
      : this.formatRelativeTime(new Date(book.downloadedAt));

    // Check if file exists (will be verified on open)
    const fileExists = true; // We'll verify on open

    return `
      <article class="book-card" data-book-id="${book.id}" data-file-exists="${fileExists}">
        <div class="book-cover">
          ${book.coverUrl
            ? `<img src="${book.coverUrl}" alt="" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />`
            : ""}
          <div class="cover-placeholder" style="display: ${book.coverUrl ? "none" : "flex"};">📖</div>
          ${!fileExists ? '<span class="missing-badge">Missing</span>' : ""}
        </div>
        <div class="book-info">
          <h3 class="book-title">${this.escapeHtml(book.title)}</h3>
          ${book.authors ? `<p class="book-author">${this.escapeHtml(book.authors)}</p>` : ""}
          <div class="book-meta">
            <span class="book-progress-label">${chapterTitle}</span>
            <span class="book-date">${lastOpened}</span>
          </div>
          ${hasProgress
            ? `
            <div class="book-progress-bar">
              <div class="book-progress-fill" style="width: ${progressBarWidth}"></div>
            </div>
            <div class="book-progress-text">${progressPercent}% read</div>
          `
            : '<div class="book-progress-text">Not started</div>'}
        </div>
        <div class="book-actions">
          <button class="btn-open" aria-label="Open ${this.escapeHtml(book.title)}">Open</button>
          <button class="btn-delete" aria-label="Delete ${this.escapeHtml(book.title)}">✕</button>
        </div>
      </article>
    `;
  }

  private attachBookCardListeners(): void {
    // Open book buttons
    this.elements.list.querySelectorAll<HTMLButtonElement>(".btn-open").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const card = btn.closest(".book-card") as HTMLElement | null;
        if (card) {
          const bookId = card.dataset.bookId;
          if (bookId) {
            this.openBook(bookId).catch(() => {
              // Error handled via callbacks.onError and markBookMissing
            });
          }
        }
      });
    });

    // Delete book buttons
    this.elements.list.querySelectorAll<HTMLButtonElement>(".btn-delete").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const card = btn.closest(".book-card") as HTMLElement | null;
        if (card) {
          const bookId = card.dataset.bookId;
          if (bookId) await this.deleteBook(bookId);
        }
      });
    });

    // Click on card (excluding buttons) to open
    this.elements.list.querySelectorAll<HTMLElement>(".book-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (!(e.target as HTMLElement).closest("button")) {
          const bookId = card.dataset.bookId;
          if (bookId) {
            this.openBook(bookId).catch(() => {
              // Error handled via callbacks.onError and markBookMissing
            });
          }
        }
      });
    });
  }

  async openBook(bookId: string): Promise<void> {
    try {
      // Find book in database
      const book = await this.bookRepo.findById(bookId);
      if (!book) {
        throw new Error(`Book not found in database: ${bookId}`);
      }

      // Read file from filesystem via Tauri
      const fileContent = await this.readBookFile(book.localPath);

      // Get saved progress
      const savedProgress = await this.progressRepo.findByBookId(bookId);

      // Open in reader
      if (this.readerController && this.readerElements) {
        await this.readerController.openBook(fileContent, {
          bookId,
          initialPosition: savedProgress?.locator,
          initialProgression: savedProgress?.progression,
        });
        this.callbacks.onOpenBook?.(bookId);
      }
    } catch (err) {
      console.error("Failed to open book:", err);
      const error = err instanceof Error ? err : new Error(String(err));

      // If file not found, mark as missing and refresh
      if (error.message.includes("not found") || error.message.includes("ENOENT")) {
        await this.markBookMissing(bookId);
      }

      this.callbacks.onError?.(error);
      throw error;
    }
  }

  private async readBookFile(localPath: string): Promise<ArrayBuffer> {
    // Use Tauri's readFile command (requires fs:allow-read permission)
    return invoke<ArrayBuffer>("read_book_file", { path: localPath });
  }

  async deleteBook(bookId: string): Promise<void> {
    if (!confirm("Delete this book from your library? This cannot be undone.")) {
      return;
    }

    try {
      // Delete from filesystem via Tauri command
      await invoke("delete_book_file", { bookId });

      // Delete from SQLite (cascades to progress, sync_state)
      await this.bookRepo.delete(bookId);

      // Refresh UI
      await this.loadBooks();
    } catch (err) {
      console.error("Failed to delete book:", err);
      const error = err instanceof Error ? err : new Error(String(err));
      this.callbacks.onError?.(error);
      alert(`Failed to delete book: ${error.message}`);
    }
  }

  private async markBookMissing(bookId: string): Promise<void> {
    // Update UI to show missing badge
    const card = this.elements.list.querySelector<HTMLElement>(`[data-book-id="${bookId}"]`);
    if (card) {
      card.dataset.fileExists = "false";
      let badge = card.querySelector(".missing-badge");
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "missing-badge";
        badge.textContent = "Missing";
        card.querySelector(".book-cover")?.appendChild(badge);
      }
      // Disable open button
      const openBtn = card.querySelector<HTMLButtonElement>(".btn-open");
      if (openBtn) {
        openBtn.disabled = true;
        openBtn.textContent = "Unavailable";
      }
    }
  }

  private showEmptyState(show: boolean): void {
    this.elements.emptyState.classList.toggle("hidden", !show);
    this.elements.list.classList.toggle("hidden", show);
  }

  private showLoading(show: boolean): void {
    this.elements.refreshBtn.disabled = show;
    this.elements.refreshBtn.textContent = show ? "⟳ Loading..." : "⟳ Refresh";
  }

  private showError(message: string): void {
    this.elements.list.innerHTML = `
      <div class="error-state">
        <p>${this.escapeHtml(message)}</p>
      </div>
    `;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  private formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  destroy(): void {
    // Cleanup if needed
  }
}