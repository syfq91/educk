import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PaperSettingController,
  normalizePaper,
  getPaper,
  setPaper,
} from "../../src/features/settings/paper.ts";

describe("Appearance: paper background switch (DESIGN.md: two backgrounds only)", () => {
  let whiteBtn: HTMLButtonElement;
  let warmBtn: HTMLButtonElement;
  let buttons: NodeListOf<HTMLButtonElement>;

  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.paper;

    document.body.innerHTML = `
      <div class="paper-toggle" role="group" aria-label="Background">
        <button type="button" class="btn-paper active" data-paper="white" aria-pressed="true">White</button>
        <button type="button" class="btn-paper" data-paper="warm" aria-pressed="false">Warm</button>
      </div>
    `;

    whiteBtn = document.querySelector<HTMLButtonElement>('[data-paper="white"]')!;
    warmBtn = document.querySelector<HTMLButtonElement>('[data-paper="warm"]')!;
    buttons = document.querySelectorAll<HTMLButtonElement>(".paper-toggle .btn-paper");
  });

  afterEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.paper;
    document.body.innerHTML = "";
  });

  it("should default to the white paper when nothing is stored", () => {
    expect(getPaper()).toBe("white");

    new PaperSettingController(buttons);

    expect(document.documentElement.dataset.paper).toBe("white");
    expect(whiteBtn.classList.contains("active")).toBe(true);
    expect(warmBtn.classList.contains("active")).toBe(false);
    expect(whiteBtn.getAttribute("aria-pressed")).toBe("true");
    expect(warmBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("should apply and persist the warm paper when selected", () => {
    new PaperSettingController(buttons);

    warmBtn.click();

    expect(document.documentElement.dataset.paper).toBe("warm");
    expect(window.localStorage.getItem("educk.paper")).toBe("warm");
    expect(warmBtn.classList.contains("active")).toBe(true);
    expect(whiteBtn.classList.contains("active")).toBe(false);
    expect(warmBtn.getAttribute("aria-pressed")).toBe("true");
    expect(whiteBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("should restore the stored paper on the next launch", () => {
    setPaper("warm");
    expect(getPaper()).toBe("warm");

    new PaperSettingController(buttons);

    expect(document.documentElement.dataset.paper).toBe("warm");
    expect(warmBtn.classList.contains("active")).toBe(true);
  });

  it("should fall back to white for unknown values", () => {
    expect(normalizePaper("dark")).toBe("white");
    expect(normalizePaper("sepia")).toBe("warm");
    expect(normalizePaper(null)).toBe("white");
    expect(normalizePaper(undefined)).toBe("white");
    expect(setPaper("dark")).toBe("white");
    expect(getPaper()).toBe("white");
  });

  it("should ignore buttons without a paper value", () => {
    delete warmBtn.dataset.paper;
    new PaperSettingController(buttons);

    warmBtn.click();

    expect(document.documentElement.dataset.paper).toBe("white");
    expect(getPaper()).toBe("white");
  });

  it("should report paper changes so the reader can stay in sync", () => {
    const onPaperChange = vi.fn();
    new PaperSettingController(buttons, onPaperChange);

    // Construction applies the stored preference but reports no change.
    expect(onPaperChange).not.toHaveBeenCalled();

    warmBtn.click();
    expect(onPaperChange).toHaveBeenCalledTimes(1);
    expect(onPaperChange).toHaveBeenCalledWith("warm");

    whiteBtn.click();
    expect(onPaperChange).toHaveBeenLastCalledWith("white");
    expect(getPaper()).toBe("white");
  });

  it("should keep working when persistent storage is unavailable", () => {
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage unavailable");
      },
    });

    try {
      expect(getPaper()).toBe("white");
      expect(setPaper("warm")).toBe("warm");
      expect(document.documentElement.dataset.paper).toBe("warm");
    } finally {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });
});
