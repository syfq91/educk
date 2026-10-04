import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Milestone M3: EPUB 2 Legacy Compatibility Verification", () => {
  const epub2Path = path.resolve(__dirname, "../../fixtures/books/valid-epub2.epub");

  it("should have valid-epub2.epub fixture with standard EPUB 2 ZIP header", () => {
    expect(fs.existsSync(epub2Path)).toBe(true);
    const buffer = fs.readFileSync(epub2Path);

    // Verify ZIP magic bytes
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
    expect(buffer[2]).toBe(0x03);
    expect(buffer[3]).toBe(0x04);

    // Verify uncompressed mimetype
    const compression = buffer.readUInt16LE(8);
    expect(compression).toBe(0);

    const filenameLen = buffer.readUInt16LE(26);
    const filename = buffer.toString("utf-8", 30, 30 + filenameLen);
    expect(filename).toBe("mimetype");

    const extraLen = buffer.readUInt16LE(28);
    const contentStart = 30 + filenameLen + extraLen;
    const mimetype = buffer.toString("utf-8", contentStart, contentStart + 20);
    expect(mimetype).toBe("application/epub+zip");
  });

  it("should contain EPUB 2 OPF package and spine pointing to NCX", () => {
    const buffer = fs.readFileSync(epub2Path);
    const content = buffer.toString("utf-8");

    expect(content).toContain('version="2.0"');
    expect(content).toContain('toc="ncx"');
    expect(content).toContain('media-type="application/x-dtbncx+xml"');
    expect(content).toContain("EPUB 2 Classic Tale");
  });

  it("should contain NCX table of contents with hierarchical navPoint structure", () => {
    const buffer = fs.readFileSync(epub2Path);
    const content = buffer.toString("utf-8");

    expect(content).toContain("<ncx");
    expect(content).toContain("http://www.daisy.org/z3986/2005/ncx/");
    expect(content).toContain("<navMap>");
    expect(content).toContain("<navPoint");
    expect(content).toContain("Part I: The Beginning");
    expect(content).toContain("Section 1: Early Waters");
    expect(content).toContain("Part II: Wide Horizons");
  });
});
