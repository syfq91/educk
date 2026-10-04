import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ReaderError,
  BookLoadError,
  NavigationError,
  UnsupportedFormatError,
} from "../../src/domain/reader.ts";
import { FoliateReaderAdapter } from "../../src/services/reader/foliate-adapter.ts";

describe("Milestone M3: Reader Error Handling & Resilience", () => {
  const fixturesDir = path.resolve(__dirname, "../../fixtures/books");
  const corruptInvalidZip = path.join(fixturesDir, "corrupted-invalid-zip.epub");
  const corruptMissingContainer = path.join(fixturesDir, "corrupted-missing-container.epub");

  it("should conform to ReaderError class inheritance hierarchy", () => {
    const baseError = new ReaderError("Base error");
    const loadError = new BookLoadError("Failed to load");
    const navError = new NavigationError("Failed to navigate");
    const formatError = new UnsupportedFormatError("Unsupported format");

    expect(baseError).toBeInstanceOf(Error);
    expect(baseError).toBeInstanceOf(ReaderError);

    expect(loadError).toBeInstanceOf(Error);
    expect(loadError).toBeInstanceOf(ReaderError);
    expect(loadError).toBeInstanceOf(BookLoadError);

    expect(navError).toBeInstanceOf(Error);
    expect(navError).toBeInstanceOf(ReaderError);
    expect(navError).toBeInstanceOf(NavigationError);

    expect(formatError).toBeInstanceOf(Error);
    expect(formatError).toBeInstanceOf(ReaderError);
    expect(formatError).toBeInstanceOf(UnsupportedFormatError);
  });

  it("should throw BookLoadError when loading a non-ZIP corrupted EPUB file", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const adapter = new FoliateReaderAdapter({ container });

    const buffer = fs.readFileSync(corruptInvalidZip);
    const blob = new Blob([buffer], { type: "application/epub+zip" });

    await expect(adapter.open(blob)).rejects.toThrowError(BookLoadError);
    expect(adapter.getState()).toBe("error");

    adapter.destroy();
    container.remove();
  });

  it("should throw BookLoadError when loading a ZIP file without META-INF/container.xml", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const adapter = new FoliateReaderAdapter({ container });

    const buffer = fs.readFileSync(corruptMissingContainer);
    const blob = new Blob([buffer], { type: "application/epub+zip" });

    await expect(adapter.open(blob)).rejects.toThrowError(BookLoadError);
    expect(adapter.getState()).toBe("error");

    adapter.destroy();
    container.remove();
  });
});
