# Network Specification — educk

How educk reaches OPDS catalogs, book files and progression endpoints on a real Android
device, and why the WebView cannot be trusted to do it.

---

## 1. The two network paths

| Traffic | Path | Rationale |
| :--- | :--- | :--- |
| Feed fetch, catalog navigation, search, facets, OPDS Progression 1.0 | Frontend → `httpRequest()` → Rust `http_request` command (`src-tauri/src/commands/http.rs`) | Bypasses WebView CORS and cleartext policy; keeps protocol I/O out of the UI layer |
| Book binaries (EPUB/PDF/…) | Frontend → `download_book` command → Rust `DownloadEngine` | Streaming to disk, atomic commit, archive validation |
| Local assets (`/sample.epub`, JS/CSS) | WebView `fetch()` | Same origin (`'self'`), no CORS implications |

`src/services/http/http-transport.ts` is the single entry point for protocol traffic. It
executes requests through the native bridge inside the Tauri runtime and transparently falls
back to `fetch` outside of it (unit tests, web preview), so callers keep one `fetch`-shaped
code path.

---

## 2. Why the WebView `fetch` cannot be used

### 2.1 CORS

OPDS servers serve Atom feeds without `Access-Control-Allow-Origin`. A feed requested from
the WebView origin (`http://tauri.localhost/`) is therefore rejected by the browser *after*
the bytes arrive, and the client can only observe `TypeError: Failed to fetch`:

```
Access to fetch at 'https://www.gutenberg.org/opds/catalog.rdf' from origin
'http://tauri.localhost' has been blocked by CORS policy: No 'Access-Control-Allow-Origin'
header is present on the requested resource.
```

This affected every public catalog (Project Gutenberg, Standard Ebooks, Feedbooks) as well
as self-hosted servers (Calibre-Web, BookFlow, Komga). A native request is not subject to
the same-origin policy, so the response body is available in full.

### 2.2 Android cleartext policy

Release builds ship with `android:usesCleartextTraffic`, which Android enforces inside the
WebView. Plain-HTTP LAN catalogs previously failed with:

```
net::ERR_CLEARTEXT_NOT_PERMITTED http://192.168.0.100:8000/opds
```

Feed traffic no longer depends on that flag because it runs natively (raw sockets are not
governed by the network security config). The manifest still permits cleartext traffic so
that **catalog covers** — plain `<img>` elements loaded by the WebView — and self-hosted
plain-HTTP servers keep working; see [security.md](security.md) for the trade-off analysis.

---

## 3. `http_request` contract

```typescript
interface HttpRequestOptions {
  method?: string;                    // GET | HEAD | POST | PUT | DELETE
  headers?: Record<string, string>;
  body?: string | null;
  timeoutMs?: number | null;          // clamped to 1s..60s
  signal?: AbortSignal | null;
}
```

Native response payload (mapped to a standard `Response` by the transport):

```typescript
interface HttpTextResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}
```

Guarantees:

- **Timeouts**: connect timeout 15s, per-request timeout from the caller, clamped to
  `[1s, 60s]`, default 15s.
- **Retries** stay in the TypeScript clients (`OPDSClient`, `ProgressionClient`) with
  exponential backoff; the native layer performs a single attempt per call.
- **HTTP error statuses are not failures**: 401/403 must reach the caller so the OPDS
  authentication prompt and progression conflict handling can react to them.
- **Cancellation**: aborting the `AbortSignal` rejects the transport promise with a
  `DOMException ("AbortError")`; the in-flight native request runs until it finishes or
  times out (Tauri commands are not interruptible).
- **Body limit**: 10 MB (`MAX_BODY_BYTES`), enforced against both `Content-Length` and the
  streamed byte count, so a hostile feed cannot exhaust memory.
- **Scheme allowlist**: only `http://` and `https://` are accepted, mirroring the download
  engine; `file:`, `data:`, `javascript:` and `content:` are rejected before any I/O.
- **Redirects**: `http(s)` targets are followed by `reqwest`; a redirect to any other scheme
  (e.g. a hostile feed answering `Location: file://...`) is never followed and the `3xx`
  response is handed back untouched, which the OPDS clients treat as a feed error.
- **Text only**: the endpoint is for Atom/JSON payloads. Binary content goes through the
  download engine, which streams to disk instead of buffering.

---

## 4. Android TLS bootstrap (why HTTPS used to crash the app)

`reqwest` with the `rustls` feature validates certificates through
`rustls-platform-verifier`. On Android that verifier delegates to the platform
`TrustManager`, which is implemented in the companion Kotlin component
(`org.rustls:rustls-platform-verifier`, class
`org.rustls.platformverifier.CertificateVerifier`) and reached through JNI.

Two things are therefore mandatory on Android:

1. **Gradle**: the Maven artifact is declared in `src-tauri/gen/android/app/build.gradle.kts`,
   with its version derived from the `rustls-platform-verifier-android` entry in
   `Cargo.lock`. A version mismatch between crate and Kotlin component is a runtime crash.
2. **Runtime**: `rustls_platform_verifier::android::init_with_env` must run with a JVM handle
   before the first HTTPS request. It is called from Tauri's `setup` hook in
   `src-tauri/src/tls.rs` using the `ndk-context` that `tao` initializes during
   `ANativeActivity::onCreate`.

Because the release profile uses `panic = "abort"`, an uninitialized verifier did not fail
gracefully — it aborted the process (`SIGABRT: Expect rustls-platform-verifier to be
initialized`) the moment an HTTPS download started. The classes are JNI-only, so R8 would
also strip them without the `-keep` rule in `proguard-rules.pro`.

Certificate validation remains the platform's: system CAs *and* user-installed CAs (for
self-hosted servers behind a private CA) are honored.

---

## 5. Verification

| Check | Where |
| :--- | :--- |
| Scheme allowlist, method allowlist, timeout clamping, body limit, status passthrough, non-HTTP redirect refusal | `src-tauri/src/commands/http.rs` (`cargo test`) |
| Native bridge request/response mapping, abort semantics, OPDS 401 mapping | `tests/unit/http-transport.test.ts` |
| Existing feed parsing, auth, retry behaviour (fetch fallback path) | `tests/unit/opds-client.test.ts`, `tests/unit/progression-client.test.ts` |
| Namespace-qualified feed elements and Chromium selector conformance | `tests/unit/opds-namespaces.test.ts` |
| Navigation-feed drill-down, breadcrumbs, Android network security & CSP config | `tests/unit/catalogs-controller.test.ts`, `tests/unit/android-network-config.test.ts` |
| On-device: feed load over HTTPS, download over HTTPS, cleartext HTTP, UI browse & navigation | Release APK on hardware, see [STATUS.md](../STATUS.md) |

The fake E2E server deliberately omits CORS headers, which documents that a WebView `fetch`
would fail there: Node's `fetch` does not enforce CORS, so only the transport boundary
above keeps production behaviour under test.
