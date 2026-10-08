import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ProgressionClient,
  ProgressionNetworkError,
  ProgressionAuthError,
  ProgressionConflictError,
  createProgressionClient,
} from "../../src/services/progression/progression-client.ts";
import type { RemoteProgressionPayload } from "../../src/domain/progression.ts";

describe("ProgressionClient (OPDS Progression 1.0)", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  const samplePayload: RemoteProgressionPayload = {
    modified: "2026-10-04T04:15:00Z",
    device: "educk-android-8a7e3d1c",
    locator: {
      href: "text/chapter02.xhtml",
      type: "application/xhtml+xml",
      title: "Chapter 2: The Departure",
      locations: {
        cfi: "epubcfi(/6/14[chap02]!/4/2/1:0)",
        progression: 0.42,
        totalProgression: 0.42,
      },
    },
  };

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("getProgression", () => {
    it("fetches and parses valid remote progression payload on HTTP 200", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/opds-progression+json" }),
        text: async () => JSON.stringify(samplePayload),
      });

      const client = createProgressionClient({ deviceId: "educk-test-dev", retryDelay: 10 });
      const result = await client.getProgression("https://catalog.example/progression/book-1");

      expect(result).not.toBeNull();
      expect(result?.modified).toBe(samplePayload.modified);
      expect(result?.device).toBe(samplePayload.device);
      expect(result?.locator.locations.totalProgression).toBe(0.42);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://catalog.example/progression/book-1");
      expect(init.method).toBe("GET");
      expect(init.headers["Accept"]).toContain("application/opds-progression+json");
      expect(init.headers["X-Device-Id"]).toBe("educk-test-dev");
      expect(init.headers["User-Agent"]).toContain("OPDS Progression 1.0 Client");
    });

    it("parses BookFlow progression schema into normalized payload", async () => {
      const bookflowPayload = {
        modified: "2026-01-27T11:00:00Z",
        progression: 0.0174,
        device: { id: "urn:uuid:019c0047-cc8d-7ec4-a3c3-938ccadc020a", name: "Reader" },
        title: "Chapter 1 - A New Dawn",
        references: ["chapter1.html"],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(bookflowPayload),
      });

      const client = createProgressionClient({ retryDelay: 10 });
      const result = await client.getProgression("https://bookflow.example/opds/publications/42/progression");

      expect(result).not.toBeNull();
      expect(result?.modified).toBe("2026-01-27T11:00:00Z");
      expect(result?.device).toBe("urn:uuid:019c0047-cc8d-7ec4-a3c3-938ccadc020a");
      expect(result?.progression).toBe(0.0174);
      expect(result?.locator.locations.totalProgression).toBe(0.0174);
      expect(result?.locator.href).toBe("chapter1.html");
      expect(result?.locator.title).toBe("Chapter 1 - A New Dawn");
    });

    it("handles HTTP 200 with empty body cleanly as null (BookFlow unread publication behavior)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      const client = createProgressionClient({ retryDelay: 10 });
      const result = await client.getProgression("https://bookflow.example/opds/publications/99/progression");

      expect(result).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("returns null on HTTP 404 (no progression recorded yet)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const client = createProgressionClient({ retryDelay: 10 });
      const result = await client.getProgression("https://catalog.example/progression/book-1");

      expect(result).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("includes Basic Auth credentials when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(samplePayload),
      });

      const client = createProgressionClient({ retryDelay: 10 });
      await client.getProgression("https://catalog.example/progression/book-1", {
        type: "basic",
        username: "alice",
        password: "secretpassword",
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers["Authorization"]).toBe(`Basic ${btoa("alice:secretpassword")}`);
    });

    it("includes Bearer Token credentials when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(samplePayload),
      });

      const client = createProgressionClient({ retryDelay: 10 });
      await client.getProgression("https://catalog.example/progression/book-1", {
        type: "bearer",
        token: "tok-jwt-12345",
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers["Authorization"]).toBe("Bearer tok-jwt-12345");
    });

    it("throws ProgressionAuthError on HTTP 401 or 403 without retrying", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      const client = createProgressionClient({ maxRetries: 3, retryDelay: 10 });
      await expect(client.getProgression("https://catalog.example/progression/book-1")).rejects.toThrow(
        ProgressionAuthError,
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("retries on HTTP 500 and succeeds on subsequent attempt", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(samplePayload),
        });

      const client = createProgressionClient({ maxRetries: 2, retryDelay: 5 });
      const result = await client.getProgression("https://catalog.example/progression/book-1");

      expect(result).not.toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws ProgressionNetworkError after exhausting retries on HTTP 500", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      });

      const client = createProgressionClient({ maxRetries: 2, retryDelay: 5 });
      await expect(client.getProgression("https://catalog.example/progression/book-1")).rejects.toThrow(
        ProgressionNetworkError,
      );
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("returns null and logs warning if response JSON has invalid schema", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ invalid: "schema", noLocator: true }),
      });

      const client = createProgressionClient({ retryDelay: 10 });
      const result = await client.getProgression("https://catalog.example/progression/book-1");

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("putProgression", () => {
    it("sends PUT request with application/opds-progression+json Content-Type and dual compatibility payload", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const client = new ProgressionClient({ deviceId: "educk-put-device", retryDelay: 10 });
      const success = await client.putProgression(
        "https://catalog.example/progression/book-1",
        samplePayload,
      );

      expect(success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://catalog.example/progression/book-1");
      expect(init.method).toBe("PUT");
      expect(init.headers["Content-Type"]).toBe("application/opds-progression+json");
      expect(init.headers["Accept"]).toContain("application/opds-progression+json");
      expect(init.headers["X-Device-Id"]).toBe("educk-put-device");

      const body = JSON.parse(init.body);
      expect(body.modified).toBe(samplePayload.modified);
      expect(body.progression).toBe(0.42);
      expect(body.device).toEqual({ id: "educk-android-8a7e3d1c", name: "educk Reader" });
      expect(body.references).toEqual(["text/chapter02.xhtml"]);
      expect(body.locator).toBeDefined();
    });

    it("accepts HTTP 201 Created and HTTP 204 No Content as successful PUT", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 201 })
        .mockResolvedValueOnce({ ok: true, status: 204 });

      const client = createProgressionClient({ retryDelay: 10 });
      const res201 = await client.putProgression("https://catalog.example/progression/1", samplePayload);
      const res204 = await client.putProgression("https://catalog.example/progression/2", samplePayload);

      expect(res201).toBe(true);
      expect(res204).toBe(true);
    });

    it("throws ProgressionConflictError immediately on HTTP 409 without retrying", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: "Conflict",
      });

      const client = createProgressionClient({ maxRetries: 3, retryDelay: 10 });
      await expect(
        client.putProgression("https://bookflow.example/opds/publications/1/progression", samplePayload),
      ).rejects.toThrow(ProgressionConflictError);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("throws ProgressionAuthError on HTTP 403 without retrying", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

      const client = createProgressionClient({ maxRetries: 3, retryDelay: 10 });
      await expect(
        client.putProgression("https://catalog.example/progression/book-1", samplePayload),
      ).rejects.toThrow(ProgressionAuthError);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("retries on network failure and throws ProgressionNetworkError when exhausted", async () => {
      mockFetch.mockRejectedValue(new Error("Network connection dropped"));

      const client = createProgressionClient({ maxRetries: 2, retryDelay: 5 });
      await expect(
        client.putProgression("https://catalog.example/progression/book-1", samplePayload),
      ).rejects.toThrow(ProgressionNetworkError);

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });
});
