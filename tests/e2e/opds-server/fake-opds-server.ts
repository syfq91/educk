import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import type { RemoteProgressionPayload } from "../../../src/domain/progression.ts";

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body?: string;
  timestamp: number;
}

export interface StoredProgression {
  bookId: string;
  payload: RemoteProgressionPayload;
  deviceId: string | null;
  receivedAt: string;
}

export class FakeOpdsServer {
  private server: http.Server | null = null;
  private port = 0;
  private isOffline = false;
  private simulate500 = false;
  private failCount = 0;
  private recordedRequests: RecordedRequest[] = [];
  private storedProgressions: Map<string, StoredProgression> = new Map();
  private sampleEpubBuffer: Buffer;

  constructor() {
    const epubPath = path.resolve(__dirname, "../../../fixtures/books/valid-sample.epub");
    if (fs.existsSync(epubPath)) {
      this.sampleEpubBuffer = fs.readFileSync(epubPath);
    } else {
      // Fallback minimal buffer if fixture not found
      this.sampleEpubBuffer = Buffer.from("PK\x03\x04test-epub-mock");
    }
  }

  public async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on("error", (err) => {
        reject(err);
      });

      this.server.listen(0, "127.0.0.1", () => {
        const address = this.server?.address();
        if (address && typeof address === "object") {
          this.port = address.port;
          resolve(this.port);
        } else {
          reject(new Error("Failed to get ephemeral port for FakeOpdsServer"));
        }
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public getPort(): number {
    return this.port;
  }

  public getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  public setOffline(offline: boolean): void {
    this.isOffline = offline;
  }

  public setSimulate500(simulate: boolean): void {
    this.simulate500 = simulate;
  }

  public setFailCount(count: number): void {
    this.failCount = count;
  }

  public getRecordedRequests(): RecordedRequest[] {
    return [...this.recordedRequests];
  }

  public clearRecordedRequests(): void {
    this.recordedRequests = [];
  }

  public setStoredProgression(bookId: string, payload: RemoteProgressionPayload, deviceId: string | null = "test-device"): void {
    this.storedProgressions.set(bookId, {
      bookId,
      payload,
      deviceId,
      receivedAt: new Date().toISOString(),
    });
  }

  public getStoredProgression(bookId: string): StoredProgression | null {
    return this.storedProgressions.get(bookId) ?? null;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // 1. Simulate offline network behavior
    if (this.isOffline) {
      req.socket.destroy();
      return;
    }

    const method = req.method || "GET";
    const reqUrl = req.url || "/";
    const parsedUrl = new URL(reqUrl, this.getBaseUrl());
    const pathname = parsedUrl.pathname;

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      this.recordedRequests.push({
        method,
        url: reqUrl,
        headers: req.headers,
        body: body || undefined,
        timestamp: Date.now(),
      });

      // 2. Simulate transient 500 errors
      if (this.simulate500 || this.failCount > 0) {
        if (this.failCount > 0) {
          this.failCount--;
        }
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Server Error (Simulated)" }));
        return;
      }

      // 3. Route handlers
      if (pathname === "/opds" || pathname === "/opds/root.xml") {
        this.serveRootFeed(res);
      } else if (pathname === "/opds/categories.xml") {
        this.serveCategoriesFeed(res);
      } else if (pathname === "/opds/books.xml") {
        this.serveBooksFeed(res);
      } else if (pathname === "/opds/books/golden-path.epub") {
        this.serveBookEpub(res);
      } else if (pathname.startsWith("/opds/progression/")) {
        const bookId = pathname.replace("/opds/progression/", "");
        if (method === "GET") {
          this.handleGetProgression(bookId, res);
        } else if (method === "PUT") {
          this.handlePutProgression(bookId, body, req.headers, res);
        } else {
          res.writeHead(405, { "Content-Type": "text/plain" });
          res.end("Method Not Allowed");
        }
      } else if (pathname === "/opds/covers/golden-path.jpg") {
        res.writeHead(200, { "Content-Type": "image/jpeg" });
        res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]));
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
      }
    });
  }

  private serveRootFeed(res: http.ServerResponse): void {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:educk:fake-opds:root</id>
  <title>Golden Path OPDS Catalog</title>
  <updated>2026-10-08T00:00:00Z</updated>
  <author>
    <name>Educk Fake Server</name>
  </author>
  <link rel="self" href="${this.getBaseUrl()}/opds/root.xml" type="application/atom+xml;profile=opds-catalog"/>
  <link rel="start" href="${this.getBaseUrl()}/opds/root.xml" type="application/atom+xml;profile=opds-catalog"/>
  <entry>
    <title>Featured Books</title>
    <id>urn:educk:fake-opds:section:books</id>
    <updated>2026-10-08T00:00:00Z</updated>
    <content type="text">Explore the full collection of books</content>
    <link rel="subsection" href="${this.getBaseUrl()}/opds/books.xml" type="application/atom+xml;profile=opds-catalog"/>
  </entry>
  <entry>
    <title>Categories</title>
    <id>urn:educk:fake-opds:section:categories</id>
    <updated>2026-10-08T00:00:00Z</updated>
    <content type="text">Browse books by category</content>
    <link rel="subsection" href="${this.getBaseUrl()}/opds/categories.xml" type="application/atom+xml;profile=opds-catalog"/>
  </entry>
</feed>`;
    res.writeHead(200, {
      "Content-Type": "application/atom+xml;profile=opds-catalog;charset=utf-8",
    });
    res.end(xml);
  }

  private serveCategoriesFeed(res: http.ServerResponse): void {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:educk:fake-opds:categories</id>
  <title>Golden Path Categories</title>
  <updated>2026-10-08T00:00:00Z</updated>
  <link rel="self" href="${this.getBaseUrl()}/opds/categories.xml" type="application/atom+xml;profile=opds-catalog"/>
  <entry>
    <title>Science &amp; Technology</title>
    <id>urn:educk:category:scitech</id>
    <updated>2026-10-08T00:00:00Z</updated>
    <link rel="subsection" href="${this.getBaseUrl()}/opds/books.xml" type="application/atom+xml;profile=opds-catalog"/>
  </entry>
</feed>`;
    res.writeHead(200, {
      "Content-Type": "application/atom+xml;profile=opds-catalog;charset=utf-8",
    });
    res.end(xml);
  }

  private serveBooksFeed(res: http.ServerResponse): void {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <id>urn:educk:fake-opds:books</id>
  <title>Golden Path Books</title>
  <updated>2026-10-08T00:00:00Z</updated>
  <link rel="self" href="${this.getBaseUrl()}/opds/books.xml" type="application/atom+xml;profile=opds-catalog"/>
  <entry>
    <title>The Golden Path Guide</title>
    <id>urn:educk:book:golden-path</id>
    <author>
      <name>Educk Test Author</name>
    </author>
    <published>2026-01-01T00:00:00Z</published>
    <updated>2026-10-08T00:00:00Z</updated>
    <summary>A comprehensive guide to the Golden Path for ebook reading.</summary>
    <dc:publisher>Educk Test Press</dc:publisher>
    <dc:identifier>urn:isbn:9780000000001</dc:identifier>
    <link rel="http://opds-spec.org/acquisition" href="${this.getBaseUrl()}/opds/books/golden-path.epub" type="application/epub+zip"/>
    <link rel="http://opds-spec.org/progression" href="${this.getBaseUrl()}/opds/progression/golden-path" type="application/vnd.readium.progression+json"/>
    <link rel="http://opds-spec.org/image" href="${this.getBaseUrl()}/opds/covers/golden-path.jpg" type="image/jpeg"/>
  </entry>
</feed>`;
    res.writeHead(200, {
      "Content-Type": "application/atom+xml;profile=opds-catalog;charset=utf-8",
    });
    res.end(xml);
  }

  private serveBookEpub(res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "application/epub+zip",
      "Content-Length": this.sampleEpubBuffer.length,
      "Content-Disposition": 'attachment; filename="golden-path.epub"',
    });
    res.end(this.sampleEpubBuffer);
  }

  private handleGetProgression(bookId: string, res: http.ServerResponse): void {
    const stored = this.storedProgressions.get(bookId);
    if (!stored) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Progression not found" }));
      return;
    }

    res.writeHead(200, {
      "Content-Type": "application/vnd.readium.progression+json",
    });
    res.end(JSON.stringify(stored.payload));
  }

  private handlePutProgression(
    bookId: string,
    body: string,
    headers: http.IncomingHttpHeaders,
    res: http.ServerResponse,
  ): void {
    try {
      const payload = JSON.parse(body) as RemoteProgressionPayload;
      const deviceId = (headers["x-device-id"] as string) || null;

      this.storedProgressions.set(bookId, {
        bookId,
        payload,
        deviceId,
        receivedAt: new Date().toISOString(),
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON payload", details: String(err) }));
    }
  }
}
