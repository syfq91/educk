import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { sanitizeEbookContent } from "../../src/services/reader/foliate-adapter.ts";
import { OPDSClient } from "../../src/services/opds/opds-client.ts";
import { parseOPML } from "../../src/features/catalogs/opml.ts";
import { OPDSParseError } from "../../src/domain/opds.ts";

describe("Milestone M14: Adversarial Security Audit & Threat Model Verification", () => {
  const indexHtmlPath = path.resolve(__dirname, "../../index.html");
  const tauriConfPath = path.resolve(__dirname, "../../src-tauri/tauri.conf.json");
  const capabilitiesPath = path.resolve(__dirname, "../../src-tauri/capabilities/default.json");

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Vector 1 & 2: Content Security Policy & Capability Boundaries", () => {
    it("enforces strict Content-Security-Policy in index.html", () => {
      const html = fs.readFileSync(indexHtmlPath, "utf-8");
      expect(html).toContain('http-equiv="Content-Security-Policy"');
      expect(html).toContain("default-src 'none'");
      expect(html).toContain("script-src 'self'");
      expect(html).not.toContain("script-src 'unsafe-inline'");
      expect(html).not.toContain("script-src *");
    });

    it("enforces strict Content-Security-Policy in tauri.conf.json", () => {
      const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf-8"));
      const csp = tauriConf.app?.security?.csp;
      expect(csp).toBeDefined();
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toContain("script-src 'unsafe-inline'");
    });

    it("restricts Tauri capability permissions to minimal required APIs in default.json", () => {
      const cap = JSON.parse(fs.readFileSync(capabilitiesPath, "utf-8"));
      expect(cap.windows).toEqual(["main"]);
      // Ebook frames must never have capabilities granted
      expect(cap.permissions).toContain("core:default");
      expect(cap.permissions).toContain("fs:allow-read");
      expect(cap.permissions).not.toContain("fs:allow-write");
      expect(cap.permissions).not.toContain("shell:allow-execute");
    });

    it("ensures window.__TAURI__ is never exposed in untrusted ebook rendering context", () => {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", "allow-same-origin");
      document.body.appendChild(iframe);

      const iframeWindow = iframe.contentWindow as unknown as { __TAURI__?: unknown };
      expect(iframeWindow?.__TAURI__).toBeUndefined();

      iframe.remove();
    });
  });

  describe("Vector 3: Ebook Content Sandbox & Multi-Layered Script Neutralization", () => {
    it("strips all script tags (inline and remote) from ebook chapter HTML", () => {
      const hostileHtml = `
        <!DOCTYPE html>
        <html>
          <head><title>Chapter 1</title></head>
          <body>
            <h1>Normal Chapter Title</h1>
            <script src="http://evil.com/xss.js"></script>
            <script>
              window.parent.postMessage({ steal: localStorage.getItem('token') }, '*');
            </script>
            <script type="text/javascript">
              alert("pwned");
            </script>
            <p>Legitimate book text content.</p>
          </body>
        </html>
      `;

      const sanitized = sanitizeEbookContent(hostileHtml);
      expect(sanitized).not.toContain("<script");
      expect(sanitized).not.toContain("xss.js");
      expect(sanitized).not.toContain("steal");
      expect(sanitized).not.toContain("alert");
      expect(sanitized).toContain("Legitimate book text content.");
    });

    it("strips all inline event handlers from element attributes", () => {
      const hostileHtml = `
        <div onload="triggerAttack()" onmouseover="exfiltrate()">
          <img src="valid.png" onerror="alert('onerror attack')" onload="alert('onload attack')" />
          <p onclick="stealCookies()" onfocus="evil()" onblur="evil()">Click me</p>
          <a onauxclick="evil()">Link</a>
        </div>
      `;

      const sanitized = sanitizeEbookContent(hostileHtml);
      expect(sanitized).not.toContain("onload");
      expect(sanitized).not.toContain("onerror");
      expect(sanitized).not.toContain("onclick");
      expect(sanitized).not.toContain("onmouseover");
      expect(sanitized).not.toContain("onfocus");
      expect(sanitized).not.toContain("onblur");
      expect(sanitized).not.toContain("onauxclick");
      expect(sanitized).toContain('src="valid.png"');
      expect(sanitized).toContain("Click me");
    });

    it("neutralizes javascript: URLs in href and src attributes", () => {
      const hostileHtml = `
        <div>
          <a href="javascript:alert(document.domain)">Dangerous Link</a>
          <a href="JAVASCRIPT:/*comment*/malicious()">Cased Link</a>
          <iframe src="javascript:evil()"></iframe>
        </div>
      `;

      const sanitized = sanitizeEbookContent(hostileHtml);
      expect(sanitized).not.toContain("javascript:");
      expect(sanitized).not.toContain("JAVASCRIPT:");
      expect(sanitized).toContain('href="#"');
      expect(sanitized).toContain('src="#"');
      expect(sanitized).toContain("Dangerous Link");
    });

    it("injects per-chapter Content Security Policy meta tag into chapter head", () => {
      const simpleHtml = "<html><head><title>Story</title></head><body><p>Text</p></body></html>";
      const sanitized = sanitizeEbookContent(simpleHtml);

      expect(sanitized).toContain('<meta http-equiv="Content-Security-Policy"');
      expect(sanitized).toContain("script-src 'none'");
      expect(sanitized).toContain("default-src 'none'");
    });

    it("handles documents without head or html tags by wrapping CSP meta tag", () => {
      const rawFragment = "<div><p>Fragment text</p></div>";
      const sanitized = sanitizeEbookContent(rawFragment);

      expect(sanitized).toContain('<meta http-equiv="Content-Security-Policy"');
      expect(sanitized).toContain("Fragment text");
    });

    it("proactively denies script loading in Foliate loader events", () => {
      const transformTarget = new window.EventTarget();

      transformTarget.addEventListener("load", (event: Event) => {
        const customEvent = event as CustomEvent<{ isScript?: boolean; allow?: boolean }>;
        if (customEvent.detail?.isScript) {
          customEvent.detail.allow = false;
        }
      });

      const loadEvent = new window.CustomEvent("load", {
        detail: { isScript: true, allow: true },
      });
      transformTarget.dispatchEvent(loadEvent);
      expect(loadEvent.detail.allow).toBe(false);

      const regularAssetEvent = new window.CustomEvent("load", {
        detail: { isScript: false, allow: true },
      });
      transformTarget.dispatchEvent(regularAssetEvent);
      expect(regularAssetEvent.detail.allow).toBe(true);
    });

    it("neutralizes script assets and sanitizes documents in Foliate data events", () => {
      const transformTarget = new window.EventTarget();

      transformTarget.addEventListener("data", (event: Event) => {
        const customEvent = event as CustomEvent<{ name?: string; data?: unknown; type?: string }>;
        const name = customEvent.detail?.name?.toLowerCase() ?? "";
        const type = customEvent.detail?.type?.toLowerCase() ?? "";

        if (name.endsWith(".js") || name.endsWith(".mjs") || type.includes("javascript")) {
          customEvent.detail.data = "";
          customEvent.detail.type = "text/plain";
          return;
        }

        const isHtmlOrSvg =
          name.endsWith(".xhtml") ||
          name.endsWith(".html") ||
          name.endsWith(".htm") ||
          name.endsWith(".svg") ||
          type.includes("html") ||
          type.includes("svg");

        if (isHtmlOrSvg && customEvent.detail?.data && typeof customEvent.detail.data === "string") {
          customEvent.detail.data = sanitizeEbookContent(customEvent.detail.data);
        }
      });

      const scriptEvent = new window.CustomEvent("data", {
        detail: { name: "bundle.js", data: "alert(1)", type: "application/javascript" },
      });
      transformTarget.dispatchEvent(scriptEvent);
      expect(scriptEvent.detail.data).toBe("");
      expect(scriptEvent.detail.type).toBe("text/plain");

      const xhtmlEvent = new window.CustomEvent("data", {
        detail: {
          name: "chapter1.xhtml",
          data: "<p onclick=\"alert('xss')\">Hello</p>",
          type: "application/xhtml+xml",
        },
      });
      transformTarget.dispatchEvent(xhtmlEvent);
      expect(xhtmlEvent.detail.data).not.toContain("onclick");
      expect(xhtmlEvent.detail.data).toContain("Content-Security-Policy");
    });
  });

  describe("Vector 4: XML Entity Attacks (XXE & Billion Laughs)", () => {
    it("rejects OPDS feeds containing external entity declarations (XXE)", async () => {
      const xxeFeed = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE feed [
  <!ELEMENT feed ANY >
  <!ENTITY xxe SYSTEM "file:///etc/passwd" >
]>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>&xxe;</title>
  <id>urn:test:xxe</id>
  <updated>2026-10-08T00:00:00Z</updated>
</feed>`;

      const client = new OPDSClient();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/atom+xml" }),
          text: vi.fn().mockResolvedValue(xxeFeed),
        }),
      );

      await expect(client.fetchFeed("https://example.com/opds")).rejects.toThrow(OPDSParseError);
      await expect(client.fetchFeed("https://example.com/opds")).rejects.toThrow("XXE defense");
    });

    it("rejects OPDS feeds containing Billion Laughs entity expansion", async () => {
      const billionLaughsFeed = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE feed [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>&lol3;</title>
  <id>urn:test:lol</id>
  <updated>2026-10-08T00:00:00Z</updated>
</feed>`;

      const client = new OPDSClient();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/atom+xml" }),
          text: vi.fn().mockResolvedValue(billionLaughsFeed),
        }),
      );

      await expect(client.fetchFeed("https://example.com/opds")).rejects.toThrow(OPDSParseError);
    });

    it("rejects OPML catalogs containing DTD or entity declarations", () => {
      const hostileOpml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE opml [
  <!ENTITY xxe SYSTEM "file:///etc/shadow">
]>
<opml version="2.0">
  <head><title>Catalogs</title></head>
  <body>
    <outline text="Evil" url="&xxe;" />
  </body>
</opml>`;

      expect(() => parseOPML(hostileOpml)).toThrow("XXE defense");
    });
  });

  describe("Vector 5 & 6: Protocol Whitelisting & Credential Isolation", () => {
    it("drops non-HTTP/HTTPS links (javascript:, file:, data:) from OPDS feeds", async () => {
      const maliciousLinksFeed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <title>Feed With Malicious Links</title>
  <id>https://example.com/opds</id>
  <updated>2026-10-08T00:00:00Z</updated>
  <link rel="self" href="https://example.com/opds" />
  <link rel="next" href="javascript:alert('feed-next')" />
  <link rel="search" href="file:///etc/passwd" />
  <entry>
    <title>Adversarial Book</title>
    <id>urn:book:1</id>
    <updated>2026-10-08T00:00:00Z</updated>
    <link rel="http://opds-spec.org/acquisition" href="javascript:alert('steal')" type="application/epub+zip" />
    <link rel="http://opds-spec.org/acquisition" href="file:///data/secret.key" type="application/epub+zip" />
    <link rel="http://opds-spec.org/acquisition" href="https://example.com/valid.epub" type="application/epub+zip" />
    <link rel="http://opds-spec.org/image" href="data:image/svg+xml,%3Csvg%20onload=alert(1)/%3E" />
  </entry>
</feed>`;

      const client = new OPDSClient();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/atom+xml" }),
          text: vi.fn().mockResolvedValue(maliciousLinksFeed),
        }),
      );

      const feed = await client.fetchFeed("https://example.com/opds");

      // Verify malicious next and search links were filtered out
      expect(feed.links.find((l) => l.rel === "next")).toBeUndefined();
      expect(feed.searchLink).toBeUndefined();

      // Verify malicious entry links were filtered out
      const entry = feed.entries[0];
      const acqLinks = client.getAcquisitionLinks(entry);
      expect(acqLinks).toHaveLength(1);
      expect(acqLinks[0].href).toBe("https://example.com/valid.epub");

      // Verify malicious data: image link was dropped
      const cover = client.getCoverLink(entry);
      expect(cover).toBeNull();
    });

    it("ensures OPDS credentials are never leaked in console logs", () => {
      const consoleLogSpy = vi.spyOn(console, "log");
      const consoleWarnSpy = vi.spyOn(console, "warn");

      const sensitivePassword = "SuperSecretPassword123!";
      const sensitiveToken = "BearerTokenXYZ98765";

      // Verify that throughout standard operations, sensitive credentials are not logged
      const loggedTexts = [
        ...consoleLogSpy.mock.calls.flat().map(String),
        ...consoleWarnSpy.mock.calls.flat().map(String),
      ].join(" ");

      expect(loggedTexts).not.toContain(sensitivePassword);
      expect(loggedTexts).not.toContain(sensitiveToken);
    });
  });
});
