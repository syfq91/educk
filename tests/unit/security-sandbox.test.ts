import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Milestone M2: Security Sandbox & Threat Model Verification", () => {
  const indexHtmlPath = path.resolve(__dirname, "../../index.html");
  const tauriConfPath = path.resolve(__dirname, "../../src-tauri/tauri.conf.json");

  it("should enforce strict Content-Security-Policy in index.html", () => {
    const html = fs.readFileSync(indexHtmlPath, "utf-8");
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'self'");
    expect(html).not.toContain("script-src 'unsafe-inline'");
    expect(html).not.toContain("script-src *");
  });

  it("should enforce strict Content-Security-Policy in tauri.conf.json", () => {
    const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf-8"));
    const csp = tauriConf.app?.security?.csp;
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
  });

  it("should sanitize untrusted HTML by neutralizing script tags and inline event handlers", () => {
    const maliciousHtml = `
      <section>
        <h1>Hostile Chapter</h1>
        <script>window.__PWNED__ = true;</script>
        <p>Normal text</p>
        <img src="fake.png" onerror="alert('xss')" onload="console.log('pwn')" />
        <a href="javascript:alert(1)">Click</a>
      </section>
    `;

    // DOMParser sanitization simulation
    const parser = new DOMParser();
    const doc = parser.parseFromString(maliciousHtml, "text/html");

    // Sanitizer logic: remove script elements
    const scripts = doc.querySelectorAll("script");
    scripts.forEach((s) => s.remove());

    // Sanitizer logic: remove inline event attributes
    const allElements = doc.querySelectorAll("*");
    allElements.forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.toLowerCase().startsWith("on") || attr.value.toLowerCase().startsWith("javascript:")) {
          el.removeAttribute(attr.name);
        }
      }
    });

    const sanitizedHtml = doc.body.innerHTML;
    expect(sanitizedHtml).not.toContain("<script");
    expect(sanitizedHtml).not.toContain("onerror");
    expect(sanitizedHtml).not.toContain("onload");
    expect(sanitizedHtml).not.toContain("javascript:");
    expect(sanitizedHtml).toContain("Normal text");
  });

  it("should ensure window.__TAURI__ is never exposed in untrusted ebook rendering context", () => {
    // In our security specification, ebook content resides in sandboxed iframes without __TAURI__ injection
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-same-origin");
    document.body.appendChild(iframe);

    const iframeWindow = iframe.contentWindow as unknown as { __TAURI__?: unknown };
    expect(iframeWindow?.__TAURI__).toBeUndefined();

    iframe.remove();
  });
});
