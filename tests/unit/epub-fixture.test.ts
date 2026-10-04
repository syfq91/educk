import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Milestone M2: EPUB Fixture Integrity Verification", () => {
  const fixturesDir = path.resolve(__dirname, "../../fixtures/books");
  const validEpub = path.join(fixturesDir, "valid-sample.epub");
  const maliciousEpub = path.join(fixturesDir, "malicious-sample.epub");

  it("should have valid-sample.epub fixture with standard EPUB 3 zip structure", () => {
    expect(fs.existsSync(validEpub)).toBe(true);
    const buffer = fs.readFileSync(validEpub);

    // 1. Verify ZIP magic bytes (PK\x03\x04)
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
    expect(buffer[2]).toBe(0x03);
    expect(buffer[3]).toBe(0x04);

    // 2. Verify compression method is Stored (0x00) for first file (mimetype)
    const compressionMethod = buffer.readUInt16LE(8);
    expect(compressionMethod).toBe(0);

    // 3. Verify filename length is 8 ('mimetype')
    const filenameLen = buffer.readUInt16LE(26);
    expect(filenameLen).toBe(8);

    const filename = buffer.toString("utf-8", 30, 30 + filenameLen);
    expect(filename).toBe("mimetype");

    // 4. Verify uncompressed mimetype string
    const extraLen = buffer.readUInt16LE(28);
    const contentStart = 30 + filenameLen + extraLen;
    const mimetypeContent = buffer.toString("utf-8", contentStart, contentStart + 20);
    expect(mimetypeContent).toBe("application/epub+zip");
  });

  it("should have malicious-sample.epub fixture containing security test payloads", () => {
    expect(fs.existsSync(maliciousEpub)).toBe(true);
    const buffer = fs.readFileSync(maliciousEpub);

    // Verify ZIP magic bytes
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);

    // Inspect content strings inside the uncompressed/compressed archive
    const rawString = buffer.toString("utf-8");
    expect(rawString).toContain("Hostile Payloads");
    expect(rawString).toContain("__TAURI_ATTACK__");
    expect(rawString).toContain("__ONERROR_TRIGGERED__");
  });
});
