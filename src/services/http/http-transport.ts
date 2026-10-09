/**
 * Application HTTP transport.
 *
 * Inside the Tauri runtime every protocol request is executed natively through the
 * `http_request` command instead of the WebView's `fetch`:
 *
 * 1. OPDS servers do not send `Access-Control-Allow-Origin`, so a WebView `fetch` is
 *    rejected by CORS before a single byte of the feed can be read.
 * 2. Android rejects cleartext `http://` requests from a WebView in release builds
 *    (`ERR_CLEARTEXT_NOT_PERMITTED`), which breaks self-hosted LAN catalogs.
 *
 * Outside of Tauri (unit tests, web preview) the transport falls back to `fetch`, so the
 * callers keep a single, `fetch`-shaped code path regardless of runtime.
 */

import { invoke } from "@tauri-apps/api/core";

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  /** Request timeout in milliseconds, enforced by the native side as well. */
  timeoutMs?: number | null;
  signal?: AbortSignal | null;
}

interface NativeHttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export const DEFAULT_TIMEOUT_MS = 15_000;

/** Error shape expected by callers that inspect `DOMException` for cancellation. */
export function createAbortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/**
 * True when the native HTTP bridge is available.
 *
 * Mirrors `isTauri()` from `@tauri-apps/api/core`, which reads the runtime flag Tauri sets on
 * the global object, plus a structural fallback: in the WebView `window === globalThis`, while
 * the unit-test harness assigns a separate `window` object even though it installs a
 * `__TAURI_INTERNALS__` mock. That distinction keeps tests on the `fetch` path.
 */
export function isNativeTransportAvailable(): boolean {
  const globals = globalThis as {
    isTauri?: unknown;
    window?: unknown;
    __TAURI_INTERNALS__?: { invoke?: unknown };
  };

  if (globals.isTauri === true) return true;
  if (globals.window !== (globalThis as unknown)) return false;

  return typeof globals.__TAURI_INTERNALS__?.invoke === "function";
}

function toResponse(payload: NativeHttpResponse): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(payload.headers ?? {})) {
    try {
      headers.append(name, value);
    } catch {
      // Skip header values the runtime refuses to represent; the status/body still arrive.
    }
  }

  const init: ResponseInit = {
    status: payload.status,
    statusText: payload.statusText,
    headers,
  };

  // The `Response` constructor forbids a body for these statuses.
  if (payload.status === 204 || payload.status === 205 || payload.status === 304) {
    return new Response(null, init);
  }
  return new Response(payload.body, init);
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === "string" ? error : JSON.stringify(error));
}

async function nativeRequest(url: string, options: HttpRequestOptions): Promise<Response> {
  const signal = options.signal ?? undefined;
  if (signal?.aborted) throw createAbortError();

  const pending = invoke<NativeHttpResponse>("http_request", {
    request: {
      url,
      method: options.method ?? "GET",
      headers: options.headers ?? null,
      body: options.body ?? null,
      timeoutMs: options.timeoutMs ?? null,
    },
  });

  if (!signal) {
    return toResponse(await pending);
  }

  return new Promise<Response>((resolve, reject) => {
    const onAbort = (): void => reject(createAbortError());
    signal.addEventListener("abort", onAbort, { once: true });

    pending.then(
      (payload) => {
        signal.removeEventListener("abort", onAbort);
        try {
          resolve(toResponse(payload));
        } catch (err) {
          reject(toError(err));
        }
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(toError(error));
      },
    );
  });
}

/**
 * Performs an HTTP request and resolves with a standard `Response`.
 *
 * Network failures reject with an `Error`; HTTP error statuses resolve normally so callers
 * can implement protocol semantics such as the OPDS 401/403 authentication challenge.
 */
export async function httpRequest(
  url: string,
  options: HttpRequestOptions = {},
): Promise<Response> {
  if (isNativeTransportAvailable()) {
    return nativeRequest(url, options);
  }

  return fetch(url, {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body ?? undefined,
    signal: options.signal ?? undefined,
  });
}
