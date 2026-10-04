# Security Specification & Threat Model — educk

## Threat Model & Untrusted Inputs
In `educk`, the following are treated as inherently untrusted:
1. **Downloaded Ebook Files (EPUB)**:
   - EPUB files are zip archives containing XHTML, CSS, SVG, images, and potential `<script>` tags.
   - Attack vectors: arbitrary JavaScript execution, iframe breakouts, WebView exploitation, ZIP slip (path traversal during extraction), ZIP bombs, CSS exfiltration.
2. **Remote OPDS Feeds**:
   - Attack vectors: XML External Entity (XXE) injection, Billion Laughs entity expansion, malicious URL schemes (`javascript:`, `file:`, `content:`), SSRF via proxy.

---

## Defensive Countermeasures

### 1. Ebook Sandbox & Execution Prevention
- **Disable Ebook Scripts**: EPUB scripts (`<script>`, inline handlers `onload=`) MUST NOT execute.
- **Iframe Sandboxing**: Foliate rendering iframe must be sandboxed. It must never possess `allow-scripts` or `allow-top-navigation`.
- **Zero Tauri Access**: Ebook documents must NEVER have access to `window.__TAURI__`, Tauri invoke handlers, or IPC channels.

### 2. Content Security Policy (CSP)
A strict CSP is enforced in `index.html` and the Tauri configuration:

```http
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' asset: data: blob: https:;
font-src 'self' asset: data:;
connect-src 'self' ipc: http: https:;
frame-src 'self' blob: data:;
```

Ebook reader frames enforce an even stricter policy (`script-src 'none'`).

### 3. Filesystem Sandboxing & Path Traversal Prevention
- **Generated Identifiers**: Storage paths are generated using cryptographic UUIDv4:
  `$APPDATA/books/<book-uuid>/book.epub`
- **Untrusted Metadata Prohibited in Paths**: Book titles, authors, and series names are stored purely in SQLite and NEVER used as filesystem folder or file names.
- **Path Sanitization**: Rust file operations reject any relative path traversal sequences (`../`, `..\\`), absolute paths, or symlink follows.
- **Atomic Operations**: Downloads stream to `<uuid>/book.epub.part` and are validated for EPUB/ZIP header validity before being renamed to `book.epub`. Incomplete or aborted downloads are automatically purged.

### 4. XML & Feed Parsing Hardening
- XML parsing uses browser `DOMParser` or Rust `quick-xml`.
- External entity resolution and DTD loading are explicitly disabled.
- URL schemes from feeds are strictly filtered: only `http:` and `https:` are accepted; `file:`, `javascript:`, `data:` are rejected.

### 5. Credential & Privacy Protection
- OPDS authentication headers are kept in secure application memory/keystore.
- No credential or authorization token is ever passed into book rendering contexts or logged to console/log files.
