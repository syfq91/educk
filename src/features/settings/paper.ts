/**
 * Appearance setting: the paper background.
 *
 * DESIGN.md supports exactly two backgrounds — pure white (`background`) and
 * warm paper white (`background-warm`) — and the user may switch between
 * them. Nothing else about the chrome varies.
 *
 * The choice is an interface preference (not application state), so it is
 * persisted to localStorage and applied as `data-paper` on the document root.
 * The stylesheet is the only thing that maps that attribute to a color token,
 * which keeps protocol/state logic out of the UI layer.
 *
 * The reader's White/Warm controls write this same preference, so the reading
 * surface and the app chrome can never show different backgrounds.
 */

export type Paper = "white" | "warm";

const STORAGE_KEY = "educk.paper";

/**
 * Any unknown or legacy value falls back to the default paper (white).
 * The pre-DESIGN.md reader theme "sepia" is warm-toned, so it migrates to
 * "warm" exactly like `normalizeReaderTheme()` does for reader settings.
 */
export function normalizePaper(value: unknown): Paper {
  return value === "warm" || value === "sepia" ? "warm" : "white";
}

/** Reads the stored preference; storage failures fall back to white. */
export function getPaper(): Paper {
  try {
    return normalizePaper(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "white";
  }
}

/** Normalizes, persists, and applies the preference. Returns the result. */
export function setPaper(value: unknown): Paper {
  const paper = normalizePaper(value);
  try {
    window.localStorage.setItem(STORAGE_KEY, paper);
  } catch {
    // Preference only: an unavailable store must not break the UI.
  }
  applyPaper(paper);
  return paper;
}

/** Applies the paper to the document root (`:root[data-paper]` in CSS). */
export function applyPaper(paper: Paper): void {
  document.documentElement.dataset.paper = paper;
}

/**
 * Binds the paper switch buttons, applies the stored preference, and reports
 * changes to the caller (used to keep the reader's paper controls in sync).
 * The selected button is signalled by the `active` class, which the design
 * system renders as an inversion (primary fill, on-primary text).
 */
export class PaperSettingController {
  private readonly buttons: NodeListOf<HTMLButtonElement>;
  private readonly onPaperChange?: (paper: Paper) => void;

  constructor(buttons: NodeListOf<HTMLButtonElement>, onPaperChange?: (paper: Paper) => void) {
    this.buttons = buttons;
    this.onPaperChange = onPaperChange;

    this.buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const raw = button.dataset.paper;
        if (!raw) return;
        const paper = setPaper(raw);
        this.sync(paper);
        this.onPaperChange?.(paper);
      });
    });

    // Apply the stored preference on startup.
    this.sync(getPaper());
  }

  /** Applies the paper and updates the switch without reporting a change. */
  public sync(paper: Paper): void {
    applyPaper(paper);
    this.buttons.forEach((button) => {
      const isActive = button.dataset.paper === paper;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }
}
