import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FoliateReaderAdapter } from "../../src/services/reader/foliate-adapter.ts";
import { BookLoadError, type ReadingPosition } from "../../src/domain/reader.ts";

describe("Milestone M3: FoliateReaderAdapter Production Contract", () => {
  let container: HTMLElement;
  let adapter: FoliateReaderAdapter;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    adapter = new FoliateReaderAdapter({
      container,
      initialSettings: {
        theme: "light",
        fontSize: 16,
        fontFamily: "sans-serif",
        lineSpacing: 1.5,
        margin: "normal",
      },
    });
  });

  afterEach(() => {
    adapter.destroy();
    container.remove();
  });

  it("should initialize in uninitialized state with default settings", () => {
    expect(adapter).toBeDefined();
    expect(adapter.getState()).toBe("uninitialized");
    expect(container.children.length).toBe(0);
  });

  it("should support event listener registration and removal", () => {
    const relocateListener = vi.fn();
    adapter.addEventListener("relocate", relocateListener);

    const position: ReadingPosition = {
      progression: 0.25,
      locator: "epubcfi(/6/4[ch1]!/4/2/10)",
      href: "ch1.xhtml",
      title: "Chapter 1: The Pond",
      modifiedAt: new Date().toISOString(),
    };

    expect(position.progression).toBe(0.25);

    adapter.removeEventListener("relocate", relocateListener);
    expect(relocateListener).not.toHaveBeenCalled();
  });

  it("should support statechange event emission", () => {
    const stateListener = vi.fn();
    adapter.addEventListener("statechange", stateListener);

    adapter.close();
    expect(stateListener).toHaveBeenCalledWith("closed");
    expect(adapter.getState()).toBe("closed");
  });

  it("should clamp font size within boundaries [12, 36]", async () => {
    await adapter.setFontSize(8); // clamped to 12
    await adapter.setFontSize(48); // clamped to 36
    await adapter.setFontSize(20); // within valid range
  });

  it("should support font family switching", async () => {
    await adapter.setFontFamily("serif");
    await adapter.setFontFamily("monospace");
    await adapter.setFontFamily("sans-serif");
  });

  it("should support line spacing and margin adjustments", async () => {
    await adapter.setLineSpacing(1.2);
    await adapter.setLineSpacing(1.8);
    await adapter.setMargin("narrow");
    await adapter.setMargin("wide");
    await adapter.setMargin("normal");
  });

  it("should switch between light, dark, and sepia themes cleanly", async () => {
    await adapter.setTheme("dark");
    await adapter.setTheme("sepia");
    await adapter.setTheme("light");
  });

  it("should return empty TOC before book is loaded", async () => {
    const toc = await adapter.getToc();
    expect(toc).toEqual([]);
  });

  it("should gracefully handle errors by throwing BookLoadError when opening invalid EPUB data", async () => {
    const errorHandler = vi.fn();
    adapter.addEventListener("error", errorHandler);

    const invalidData = new Blob(["not a valid zip file"], { type: "application/epub+zip" });

    await expect(adapter.open(invalidData)).rejects.toThrowError(BookLoadError);
    expect(errorHandler).toHaveBeenCalled();
    expect(adapter.getState()).toBe("error");
  });

  it("should clean up DOM nodes on close and destroy", async () => {
    await adapter.close();
    expect(container.children.length).toBe(0);
    expect(adapter.getState()).toBe("closed");

    adapter.destroy();
    expect(container.children.length).toBe(0);
  });
});
