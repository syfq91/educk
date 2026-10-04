import { invoke } from "@tauri-apps/api/core";
import { FoliateReaderAdapter } from "./services/reader/foliate-adapter.ts";
import type { ReaderTheme } from "./domain/reader.ts";

let activeReader: FoliateReaderAdapter | null = null;
let currentFontSize = 18;
let currentTheme: ReaderTheme = "light";

// Navigation view switching
function setupNavigation(): void {
  const navButtons = document.querySelectorAll<HTMLButtonElement>(".bottom-nav .nav-item");
  const viewPanels = document.querySelectorAll<HTMLElement>(".view-panel");

  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.target;
      if (!targetId) return;

      navButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");

      viewPanels.forEach((panel) => {
        if (panel.id === targetId) {
          panel.classList.add("active");
        } else {
          panel.classList.remove("active");
        }
      });
    });
  });
}

// Reader Spike Setup & Event Wiring
function setupReaderSpike(): void {
  const openSpikeBtn = document.querySelector<HTMLButtonElement>("#btn-open-spike");
  const readerView = document.querySelector<HTMLElement>("#reader-view");
  const readerMount = document.querySelector<HTMLElement>("#reader-mount");
  const backBtn = document.querySelector<HTMLButtonElement>("#reader-btn-back");
  const prevBtn = document.querySelector<HTMLButtonElement>("#reader-btn-prev");
  const nextBtn = document.querySelector<HTMLButtonElement>("#reader-btn-next");

  const titleEl = document.querySelector<HTMLElement>("#reader-title");
  const chapterEl = document.querySelector<HTMLElement>("#reader-chapter");
  const progressBadge = document.querySelector<HTMLElement>("#reader-progress-badge");
  const cfiEl = document.querySelector<HTMLElement>("#reader-cfi");
  const fontSizeVal = document.querySelector<HTMLElement>("#font-size-val");
  const smallerFontBtn = document.querySelector<HTMLButtonElement>("#btn-font-smaller");
  const largerFontBtn = document.querySelector<HTMLButtonElement>("#btn-font-larger");
  const themeButtons = document.querySelectorAll<HTMLButtonElement>(".theme-btn");

  if (!openSpikeBtn || !readerView || !readerMount) return;

  const closeReader = async () => {
    if (activeReader) {
      await activeReader.close();
      activeReader.destroy();
      activeReader = null;
    }
    readerView.classList.add("hidden");
  };

  backBtn?.addEventListener("click", () => {
    void closeReader();
  });

  prevBtn?.addEventListener("click", () => {
    void activeReader?.previous();
  });

  nextBtn?.addEventListener("click", () => {
    void activeReader?.next();
  });

  smallerFontBtn?.addEventListener("click", () => {
    currentFontSize = Math.max(12, currentFontSize - 2);
    if (fontSizeVal) fontSizeVal.textContent = `${currentFontSize}px`;
    void activeReader?.setFontSize(currentFontSize);
  });

  largerFontBtn?.addEventListener("click", () => {
    currentFontSize = Math.min(36, currentFontSize + 2);
    if (fontSizeVal) fontSizeVal.textContent = `${currentFontSize}px`;
    void activeReader?.setFontSize(currentFontSize);
  });

  themeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const selectedTheme = btn.dataset.theme as ReaderTheme;
      if (!selectedTheme) return;
      currentTheme = selectedTheme;
      themeButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // Update overlay background
      const themeColors: Record<ReaderTheme, { bg: string; text: string }> = {
        light: { bg: "#ffffff", text: "#1a1a1a" },
        dark: { bg: "#121212", text: "#e0e0e0" },
        sepia: { bg: "#f4ecd8", text: "#3d2b1f" },
      };
      readerView.style.backgroundColor = themeColors[selectedTheme].bg;
      readerView.style.color = themeColors[selectedTheme].text;

      void activeReader?.setTheme(selectedTheme);
    });
  });

  openSpikeBtn.addEventListener("click", async () => {
    try {
      readerView.classList.remove("hidden");
      if (titleEl) titleEl.textContent = "Loading sample EPUB...";
      if (cfiEl) cfiEl.textContent = "initializing...";

      if (!activeReader) {
        activeReader = new FoliateReaderAdapter({
          container: readerMount,
          initialSettings: {
            theme: currentTheme,
            fontSize: currentFontSize,
          },
        });

        activeReader.addEventListener("load", (metadata) => {
          if (titleEl) titleEl.textContent = metadata.title;
        });

        activeReader.addEventListener("relocate", (position) => {
          const percent = Math.round(position.progression * 100);
          if (progressBadge) progressBadge.textContent = `${percent}%`;
          if (chapterEl) chapterEl.textContent = position.title || "Reading";
          if (cfiEl) cfiEl.textContent = position.locator || "—";
        });

        activeReader.addEventListener("error", (error) => {
          console.error("Reader error:", error);
          if (titleEl) titleEl.textContent = "Error loading book";
        });
      }

      // Fetch the sample EPUB bundled in public/
      const res = await fetch("/sample.epub");
      if (!res.ok) {
        throw new Error(`Failed to load /sample.epub: HTTP ${res.status}`);
      }
      const blob = await res.blob();
      await activeReader.open(blob);
    } catch (err) {
      console.error("Failed to open test EPUB spike:", err);
      alert(`Could not open reader spike: ${String(err)}`);
    }
  });
}

// Backend version and status initialization
async function initApp(): Promise<void> {
  const versionBadge = document.querySelector<HTMLElement>("#app-version");
  const feVersionEl = document.querySelector<HTMLElement>("#fe-version");
  const backendStatusEl = document.querySelector<HTMLElement>("#backend-status");

  try {
    const backendVersion = await invoke<string>("get_app_version");
    if (versionBadge) {
      versionBadge.textContent = `v${backendVersion}`;
    }
    if (feVersionEl) {
      feVersionEl.textContent = backendVersion;
    }
    if (backendStatusEl) {
      backendStatusEl.textContent = "Connected (Rust Tauri 2)";
      backendStatusEl.style.color = "var(--status-success)";
    }
  } catch (err) {
    // When running in a standard browser without Tauri backend
    console.warn("Tauri backend not detected or command failed:", err);
    if (backendStatusEl) {
      backendStatusEl.textContent = "Web preview (IPC disconnected)";
      backendStatusEl.style.color = "var(--text-secondary)";
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  setupNavigation();
  setupReaderSpike();
  void initApp();
});
