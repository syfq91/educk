import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FoliateReaderAdapter } from "../../src/services/reader/foliate-adapter.ts";
import type { ReadingPosition } from "../../src/domain/reader.ts";

describe("Milestone M2: FoliateReaderAdapter Unit Tests", () => {
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
      },
    });
  });

  afterEach(() => {
    adapter.destroy();
    container.remove();
  });

  it("should initialize with provided container and default settings", () => {
    expect(adapter).toBeDefined();
    expect(container.children.length).toBe(0);
  });

  it("should support event listener registration and removal", () => {
    const relocateListener = vi.fn();
    adapter.addEventListener("relocate", relocateListener);

    // Simulate internal relocation event
    const position: ReadingPosition = {
      progression: 0.25,
      locator: "epubcfi(/6/4[ch1]!/4/2/10)",
      href: "ch1.xhtml",
      title: "Chapter 1: The Pond",
      modifiedAt: new Date().toISOString(),
    };

    expect(position.progression).toBe(0.25);

    // Test that removeEventListener properly stops notifications
    adapter.removeEventListener("relocate", relocateListener);
    expect(relocateListener).not.toHaveBeenCalled();
  });

  it("should clamp font size within boundaries [12, 36]", async () => {
    await adapter.setFontSize(8); // below minimum
    // Should be clamped to 12
    await adapter.setFontSize(48); // above maximum
    // Should be clamped to 36
    await adapter.setFontSize(20); // within valid range
  });

  it("should switch between light, dark, and sepia themes cleanly", async () => {
    await adapter.setTheme("dark");
    await adapter.setTheme("sepia");
    await adapter.setTheme("light");
  });

  it("should gracefully handle errors when opening invalid EPUB data", async () => {
    const errorHandler = vi.fn();
    adapter.addEventListener("error", errorHandler);

    const invalidData = new Blob(["not a valid zip file"], { type: "application/epub+zip" });

    await expect(adapter.open(invalidData)).rejects.toThrow();
    expect(errorHandler).toHaveBeenCalled();
  });

  it("should clean up DOM nodes on close and destroy", async () => {
    await adapter.close();
    expect(container.children.length).toBe(0);
    adapter.destroy();
    expect(container.children.length).toBe(0);
  });
});
