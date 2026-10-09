import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  httpRequest,
  isNativeTransportAvailable,
} from "../../src/services/http/http-transport.ts";
import { OPDSClient } from "../../src/services/opds/opds-client.ts";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

type TauriGlobals = { isTauri?: boolean; __TAURI_INTERNALS__?: { invoke: unknown } };

const globals = globalThis as TauriGlobals;
const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;

function enableNativeRuntime(): void {
  globals.isTauri = true;
}

describe("HTTP transport", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockFetch.mockReset();
    delete globals.isTauri;
  });

  afterEach(() => {
    delete globals.isTauri;
  });

  describe("runtime detection", () => {
    it("uses the native bridge when the Tauri runtime flag is set", () => {
      enableNativeRuntime();
      expect(isNativeTransportAvailable()).toBe(true);
    });

    it("falls back to fetch outside of the Tauri runtime", () => {
      // The test harness installs `__TAURI_INTERNALS__` and a detached `window`, which must
      // not be mistaken for a real WebView.
      expect(isNativeTransportAvailable()).toBe(false);
    });
  });

  describe("fetch fallback", () => {
    it("delegates to fetch with method, headers and signal", async () => {
      const response = new Response("<feed/>", {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      });
      mockFetch.mockResolvedValue(response);
      const controller = new AbortController();

      const result = await httpRequest("https://example.com/opds", {
        method: "GET",
        headers: { Accept: "application/atom+xml" },
        signal: controller.signal,
      });

      expect(mockFetch).toHaveBeenCalledWith("https://example.com/opds", {
        method: "GET",
        headers: { Accept: "application/atom+xml" },
        body: undefined,
        signal: controller.signal,
      });
      expect(result).toBe(response);
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  describe("native bridge", () => {
    it("issues the http_request command and maps the payload to a Response", async () => {
      enableNativeRuntime();
      mockInvoke.mockResolvedValue({
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/atom+xml; charset=utf-8" },
        body: "<feed><title>Catalog</title></feed>",
      });

      const response = await httpRequest("https://example.com/opds", {
        method: "GET",
        headers: { Accept: "application/atom+xml" },
        timeoutMs: 15_000,
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockInvoke).toHaveBeenCalledWith("http_request", {
        request: {
          url: "https://example.com/opds",
          method: "GET",
          headers: { Accept: "application/atom+xml" },
          body: null,
          timeoutMs: 15_000,
        },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/atom+xml");
      expect(await response.text()).toBe("<feed><title>Catalog</title></feed>");
    });

    it("preserves HTTP error statuses so the auth challenge stays visible", async () => {
      enableNativeRuntime();
      mockInvoke.mockResolvedValue({
        status: 401,
        statusText: "Unauthorized",
        headers: {},
        body: "",
      });

      const response = await httpRequest("http://192.168.0.100:8000/opds");

      expect(response.status).toBe(401);
      expect(response.ok).toBe(false);
    });

    it("supports bodyless statuses such as 204", async () => {
      enableNativeRuntime();
      mockInvoke.mockResolvedValue({
        status: 204,
        statusText: "No Content",
        headers: {},
        body: "",
      });

      const response = await httpRequest("https://example.com/progression", { method: "PUT" });

      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
    });

    it("rejects with an Error when the native command fails", async () => {
      enableNativeRuntime();
      mockInvoke.mockRejectedValue("Could not connect to the server");

      await expect(httpRequest("https://example.com/opds")).rejects.toThrow(
        "Could not connect to the server",
      );
    });

    it("rejects with a DOMException when the caller aborts", async () => {
      enableNativeRuntime();
      mockInvoke.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ status: 200, statusText: "OK", headers: {}, body: "" }), 50);
          }),
      );
      const controller = new AbortController();
      const pending = httpRequest("https://example.com/opds", { signal: controller.signal });

      controller.abort();

      await expect(pending).rejects.toSatisfy(
        (error: unknown) => error instanceof DOMException && error.name === "AbortError",
      );
    });

    it("rejects immediately when the signal is already aborted", async () => {
      enableNativeRuntime();
      const controller = new AbortController();
      controller.abort();

      await expect(
        httpRequest("https://example.com/opds", { signal: controller.signal }),
      ).rejects.toSatisfy(
        (error: unknown) => error instanceof DOMException && error.name === "AbortError",
      );
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  describe("OPDS browsing over the native bridge", () => {
    it("loads feeds through http_request instead of the WebView fetch", async () => {
      enableNativeRuntime();
      mockInvoke.mockResolvedValue({
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/atom+xml" },
        body: `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>https://example.com/opds</id>
  <title>Native Catalog</title>
  <updated>2024-01-01T00:00:00Z</updated>
</feed>`,
      });

      const feed = await new OPDSClient().fetchFeed("https://example.com/opds");

      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockInvoke).toHaveBeenCalledWith(
        "http_request",
        expect.objectContaining({
          request: expect.objectContaining({ url: "https://example.com/opds", method: "GET" }),
        }),
      );
      expect(feed.title).toBe("Native Catalog");
    });

    it("maps a 401 response to an authentication challenge", async () => {
      enableNativeRuntime();
      mockInvoke.mockResolvedValue({ status: 401, statusText: "Unauthorized", headers: {}, body: "" });

      await expect(new OPDSClient().fetchFeed("https://example.com/opds")).rejects.toThrow(
        /Authentication required/,
      );
    });
  });
});
