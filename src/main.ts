import { invoke } from "@tauri-apps/api/core";

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
  initApp();
});
