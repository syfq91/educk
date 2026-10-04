import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Milestone M2: Vendored foliate-js Verification", () => {
  const vendorDir = path.resolve(__dirname, "../../vendor/foliate-js");
  const commitFile = path.join(vendorDir, "COMMIT");

  it("should have vendored foliate-js directory with required core modules", () => {
    expect(fs.existsSync(vendorDir)).toBe(true);

    const requiredModules = [
      "view.js",
      "paginator.js",
      "epub.js",
      "epubcfi.js",
      "progress.js",
      "overlayer.js",
      "vendor/zip.js",
    ];

    for (const mod of requiredModules) {
      const fullPath = path.join(vendorDir, mod);
      expect(fs.existsSync(fullPath), `Module ${mod} must exist in vendor/foliate-js`).toBe(true);
    }
  });

  it("should have COMMIT file pinning exact upstream commit", () => {
    expect(fs.existsSync(commitFile)).toBe(true);
    const commitContent = fs.readFileSync(commitFile, "utf-8");

    expect(commitContent).toContain("repository: https://github.com/johnfactotum/foliate-js.git");
    expect(commitContent).toContain("commit: 78914aef4466eb960965702401634c2cb348e9b1");
  });

  it("should not contain unneeded git subtrees inside vendor", () => {
    expect(fs.existsSync(path.join(vendorDir, ".git"))).toBe(false);
    expect(fs.existsSync(path.join(vendorDir, ".github"))).toBe(false);
  });
});
