import { invoke } from "@tauri-apps/api/core";
import { ReaderViewController, type ReaderViewElements } from "./features/reader/reader-view.ts";

let readerController: ReaderViewController | null = null;

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

// Production Reader View Controller Initialization
function setupReader(): void {
  const overlay = document.querySelector<HTMLElement>("#reader-view");
  const mount = document.querySelector<HTMLElement>("#reader-mount");
  const backBtn = document.querySelector<HTMLButtonElement>("#reader-btn-back");
  const title = document.querySelector<HTMLElement>("#reader-title");
  const chapter = document.querySelector<HTMLElement>("#reader-chapter");
  const progressBadge = document.querySelector<HTMLElement>("#reader-progress-badge");
  const cfiDisplay = document.querySelector<HTMLElement>("#reader-cfi");
  const tocBtn = document.querySelector<HTMLButtonElement>("#reader-btn-toc");
  const tocDrawer = document.querySelector<HTMLElement>("#reader-toc-drawer");
  const tocList = document.querySelector<HTMLElement>("#reader-toc-list");
  const tocBackdrop = document.querySelector<HTMLElement>("#reader-backdrop");
  const tocCloseBtn = document.querySelector<HTMLButtonElement>("#btn-close-toc");
  const settingsBtn = document.querySelector<HTMLButtonElement>("#reader-btn-settings");
  const settingsDrawer = document.querySelector<HTMLElement>("#reader-settings-drawer");
  const settingsCloseBtn = document.querySelector<HTMLButtonElement>("#btn-close-settings");
  const prevBtn = document.querySelector<HTMLButtonElement>("#reader-btn-prev");
  const nextBtn = document.querySelector<HTMLButtonElement>("#reader-btn-next");
  const slider = document.querySelector<HTMLInputElement>("#reader-progress-slider");
  const themeButtons = document.querySelectorAll<HTMLButtonElement>(".theme-btn");
  const fontSizeLabel = document.querySelector<HTMLElement>("#font-size-val");
  const smallerFontBtn = document.querySelector<HTMLButtonElement>("#btn-font-smaller");
  const largerFontBtn = document.querySelector<HTMLButtonElement>("#btn-font-larger");
  const fontFamilySelect = document.querySelector<HTMLSelectElement>("#select-font-family") ?? undefined;
  const lineSpacingSelect = document.querySelector<HTMLSelectElement>("#select-line-spacing") ?? undefined;
  const marginSelect = document.querySelector<HTMLSelectElement>("#select-margin") ?? undefined;
  const tapZoneLeft = document.querySelector<HTMLElement>("#tap-zone-left") ?? undefined;
  const tapZoneCenter = document.querySelector<HTMLElement>("#tap-zone-center") ?? undefined;
  const tapZoneRight = document.querySelector<HTMLElement>("#tap-zone-right") ?? undefined;

  if (
    !overlay ||
    !mount ||
    !backBtn ||
    !title ||
    !chapter ||
    !progressBadge ||
    !cfiDisplay ||
    !tocBtn ||
    !tocDrawer ||
    !tocList ||
    !tocBackdrop ||
    !tocCloseBtn ||
    !settingsBtn ||
    !settingsDrawer ||
    !settingsCloseBtn ||
    !prevBtn ||
    !nextBtn ||
    !slider ||
    !fontSizeLabel ||
    !smallerFontBtn ||
    !largerFontBtn
  ) {
    console.error("Required Reader DOM elements not found.");
    return;
  }

  const elements: ReaderViewElements = {
    overlay,
    mount,
    backBtn,
    title,
    chapter,
    progressBadge,
    cfiDisplay,
    tocBtn,
    tocDrawer,
    tocList,
    tocBackdrop,
    tocCloseBtn,
    settingsBtn,
    settingsDrawer,
    settingsCloseBtn,
    prevBtn,
    nextBtn,
    slider,
    themeButtons,
    fontSizeLabel,
    smallerFontBtn,
    largerFontBtn,
    fontFamilySelect,
    lineSpacingSelect,
    marginSelect,
    tapZoneLeft,
    tapZoneCenter,
    tapZoneRight,
  };

  readerController = new ReaderViewController(elements, {
    theme: "light",
    fontSize: 18,
    lineSpacing: 1.5,
    fontFamily: "sans-serif",
    margin: "normal",
  });

  // Launch EPUB 3 Sample
  const btnEpub3 = document.querySelector<HTMLButtonElement>("#btn-open-epub3");
  btnEpub3?.addEventListener("click", async () => {
    try {
      const res = await fetch("/sample.epub");
      if (!res.ok) throw new Error(`HTTP ${res.status} loading /sample.epub`);
      const blob = await res.blob();
      await readerController?.openBook(blob);
    } catch (err) {
      console.error("Failed to open EPUB 3:", err);
      alert(`Could not open EPUB 3 sample: ${String(err)}`);
    }
  });

  // Launch EPUB 2 Sample
  const btnEpub2 = document.querySelector<HTMLButtonElement>("#btn-open-epub2");
  btnEpub2?.addEventListener("click", async () => {
    try {
      const res = await fetch("/sample-epub2.epub");
      if (!res.ok) throw new Error(`HTTP ${res.status} loading /sample-epub2.epub`);
      const blob = await res.blob();
      await readerController?.openBook(blob);
    } catch (err) {
      console.error("Failed to open EPUB 2:", err);
      alert(`Could not open EPUB 2 sample: ${String(err)}`);
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
    console.warn("Tauri backend not detected or command failed:", err);
    if (backendStatusEl) {
      backendStatusEl.textContent = "Web preview (IPC disconnected)";
      backendStatusEl.style.color = "var(--text-secondary)";
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  setupNavigation();
  setupReader();
  void initApp();
});
