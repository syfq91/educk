# Security Specification & Adversarial Threat Model — educk

## Threat Model & Untrusted Inputs
In `educk`, the following are treated as inherently untrusted inputs:
1. **Downloaded Ebook Files (EPUB)**:
   - EPUB files are ZIP archives containing XHTML, CSS, SVG, images, and potential `<script>` tags.
   - Attack vectors: arbitrary JavaScript execution, iframe breakouts, WebView exploitation, ZIP slip (path traversal during extraction), ZIP bombs, entry count exhaustion, and CSS exfiltration.
2. **Remote OPDS Feeds & OPML Catalogs**:
   - Attack vectors: XML External Entity (XXE) injection, Billion Laughs entity expansion, malicious URL schemes (`javascript:`, `file:`, `data:`, `content:`), SSRF via proxy.

---

## Defensive Countermeasures & Milestone 14 Audit Verification

### 1. Ebook Sandbox & Multi-Layered Script Neutralization
- **Strict Content-Security-Policy**: Enforced in `index.html` and `src-tauri/tauri.conf.json`:
  ```http
  default-src 'none';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' asset: data: blob: https:;
  font-src 'self' asset: data:;
  connect-src 'self' ipc: http: https:;
  frame-src 'self' blob: data:;
  ```
- **Foliate Loader Hook**: Intercepts `load` events from the underlying foliate loader and proactively denies any script resources (`event.detail.allow = false` when `event.detail.isScript = true`).
- **Data Hook Script Stripping**: In the `data` event hook, `.js` and `.mjs` assets or MIME types containing `javascript` are neutralized to empty `text/plain` assets.
- **HTML/XHTML/SVG Sanitization (`sanitizeEbookContent`)**:
  - Strips all `<script>...</script>` elements (inline or remote).
  - Removes all inline event attributes (`onload`, `onerror`, `onclick`, `onmouseover`, etc.).
  - Replaces all `javascript:` scheme URLs in `href` and `src` attributes with `#`.
  - Injects per-chapter CSP meta tag: `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src blob: data:; font-src blob: data:;">`.
- **Zero Tauri Access**: Ebook documents never have access to `window.__TAURI__`, Tauri invoke handlers, or IPC channels. Capability `default.json` only grants minimal filesystem read access to the main window, with execution and write capabilities completely disabled.

### 2. Filesystem Sandboxing & Path Traversal Defenses
- **Generated Identifiers**: Storage paths are generated using cryptographic UUIDv4:
  `$APPDATA/books/<book-uuid>/book.epub`
- **Untrusted Metadata Prohibited in Paths**: Book titles, authors, and series names are stored purely in SQLite and NEVER used as filesystem folder or file names.
- **Path Canonicalization & Boundary Enforcement**:
  - `read_book_file` checks for null byte injection (`path.contains('\0')`).
  - Canonicalizes paths and ensures `canonical_path.starts_with(&app_data_dir)`.
  - Rejects directory paths or symlink escapes (`canonical_path.is_file()`).
- **Atomic Operations**: Downloads stream to `<uuid>/book.epub.part` and are validated for EPUB/ZIP header validity before being renamed to `book.epub`. Incomplete or aborted downloads are automatically purged.

### 3. ZIP Bomb & Archive Decompression Defenses
- In `src-tauri/src/downloads/validator.rs`:
  - **Magic Header Validation**: Enforces EPUB 2/3 container structure (`PK\x03\x04` and uncompressed `mimetype` with `application/epub+zip`).
  - **Decompressed Size Limit**: Enforces a strict ceiling (`MAX_UNCOMPRESSED_SIZE = 500 MB`).
  - **Compression Ratio Limit**: Rejects archives exceeding `MAX_COMPRESSION_RATIO = 100:1`.
  - **Archive Entry Count Exhaustion**: Enforces `MAX_ENTRY_COUNT = 10_000` to prevent denial of service via huge numbers of entries.

### 4. XML Entity Attacks (XXE & Billion Laughs)
- **Atom XML & OPML Sanitization**:
  - Prior to parsing via `DOMParser`, raw XML text is inspected via `validateSafeXml` in `src/services/opds/opds-client.ts` and `parseOPML` in `src/features/catalogs/opml.ts`.
  - Rejects any presence of `<!DOCTYPE` or `<!ENTITY` declarations with `OPDSParseError` (RFC 4287 strict compliance).
  - Prevents external entity exfiltration (`file:///etc/passwd`, internal network endpoints) and exponential entity expansion attacks.
  - Parse errors abort immediately without useless network retry loops.

### 5. URL Scheme Poisoning & Network Boundary Defense
- **Protocol Whitelisting**:
  - `start_download` in Rust validates that download URLs start with `http://` or `https://`, rejecting `file:`, `javascript:`, `content:`, or custom schemes.
  - `OPDSClient.resolveUrl` strictly enforces `http:` and `https:` schemes, dropping any malicious URLs from feeds, acquisition links, next/search links, and covers.

### 6. Credential & Privacy Protection
- OPDS authentication headers (`Basic` and `Bearer`) are kept in isolated application state.
- No credential or authorization token is ever passed into book rendering contexts or logged to console/log files.

---

## Adversarial Audit Verification Matrix

| Vulnerability Vector | Defense Layer | Verified In | Status |
|---|---|---|---|
| Ebook Script Execution (XSS) | Loader denial + XHTML sanitizer + CSP injection | `tests/unit/security-sandbox.test.ts` | Pass |
| Tauri IPC Leakage to Ebooks | Window boundary isolation + capability `default.json` | `tests/unit/security-sandbox.test.ts` | Pass |
| Path Traversal (`../`, null bytes, symlinks) | Canonicalization + prefix check + `is_file()` | `src-tauri/src/commands/library.rs` | Pass |
| ZIP Bomb (Gigabyte expansion) | Ratio check (100:1) + max uncompressed size (500 MB) | `src-tauri/src/downloads/validator.rs` | Pass |
| ZIP Entry Exhaustion (DoS) | `MAX_ENTRY_COUNT = 10_000` entry limit | `src-tauri/src/downloads/validator.rs` | Pass |
| XXE & Billion Laughs | DTD & entity rejection in OPDS Atom & OPML | `tests/unit/security-sandbox.test.ts` | Pass |
| Malicious URL Injection (`javascript:`, `file:`) | Scheme whitelisting (`http`/`https`) in Rust & TS | `tests/unit/security-sandbox.test.ts` | Pass |
| Credential Leakage in Logs | Zero logging of sensitive auth tokens | `tests/unit/security-sandbox.test.ts` | Pass |
