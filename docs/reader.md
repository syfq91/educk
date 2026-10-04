# Foliate-js Reader Integration & Android Spike Report

## Overview
This document records the findings, architectural decisions, and verification results of **Milestone M2: Foliate-js Android Proof of Concept Spike**.

The goal of this spike was to prove that `foliate-js` can reliably render a locally stored EPUB inside the Tauri Android WebView under strict security boundaries and offline conditions.

---

## 1. Upstream Engine & Vendoring Strategy

- **Upstream Repository**: [johnfactotum/foliate-js](https://github.com/johnfactotum/foliate-js)
- **Pinned Commit**: `78914aef4466eb960965702401634c2cb348e9b1` (May 1, 2026)
- **Vendoring Path**: `vendor/foliate-js/` with tracked `COMMIT` metadata.
- **Upstream Stability**: Upstream maintainers explicitly state that internal APIs are evolving and recommend vendoring rather than relying on floating npm releases.
- **Zero Runtime Dependencies**: The vendored engine uses native browser ES modules with bundled `@zip.js/zip.js` and `fflate.js`. No npm runtime dependencies are introduced.

---

## 2. Component Hierarchy & Shadow DOM Boundaries

`foliate-js` organizes rendering through two primary custom elements:

```text
[DOM Container (#reader-mount)]
             │
             ▼
      <foliate-view> (Custom Element)
             │
             ├── Shadow Root (mode: 'closed')
             │         │
             │         ▼
             │   <foliate-paginator> (Custom Element)
             │         │
             │         ▼
             │   <iframe part="filter" sandbox="allow-same-origin allow-scripts">
             │         │
             │         ▼
             │   [Rendered Ebook XHTML Document (Blob URL)]
             │
             └── Pure DOM Events
                       ├── 'relocate' -> { cfi, fraction, location, tocItem }
                       └── 'load' -> book metadata & spine structure
```

---

## 3. Security Sandbox & Script Disabling

Downloaded EPUB files are treated as untrusted input. EPUB specifications allow JavaScript, but in `educk`, ebook JavaScript execution is strictly prohibited.

### Defense-in-Depth Protection Layers
1. **Asset Interception**:
   - `FoliateReaderAdapter` listens to resource loading on `book.transformTarget`.
   - Any script assets (`.js`, `.mjs`) have their payload suppressed and returned as empty strings.
2. **Document Sanitization**:
   - Section XHTML documents have `<script>` tags and inline event handlers (`onload`, `onerror`, `onclick`, `onmouseover`) neutralized before rendering.
3. **Content Security Policy (CSP)**:
   - Configured in `index.html` and `src-tauri/tauri.conf.json`:
     ```http
     default-src 'none';
     script-src 'self';
     style-src 'self' 'unsafe-inline';
     img-src 'self' asset: data: blob: https:;
     font-src 'self' asset: data:;
     connect-src 'self' ipc: http: https:;
     frame-src 'self' blob: data:;
     ```
   - Ebook sections are loaded as `blob:` URLs under `frame-src 'self' blob: data:`, with script execution blocked by `script-src 'self'`.
4. **IPC Isolation**:
   - The rendering iframe has zero access to `window.__TAURI__`, Tauri command handlers, or filesystem APIs.

---

## 4. Reading Position & Canonical Fragment Identifiers (CFI)

Foliate emits `relocate` events on every page navigation:

```typescript
export interface ReadingPosition {
  bookId?: string;
  progression: number; // 0.0 - 1.0 (e.g. 0.45 = 45%)
  locator: string;     // EPUB CFI string (e.g. "epubcfi(/6/4[ch1]!/4/2/10)")
  href?: string;       // Spine item path (e.g. "EPUB/ch1.xhtml")
  title?: string;      // Chapter name (e.g. "Chapter 1: The Pond")
  modifiedAt?: string; // ISO 8601 UTC timestamp
}
```

- **Restoration**: Passing `locator` to `reader.goTo(position.locator)` restores the exact visual viewport without layout shifts.
- **Progression**: The `fraction` (0.0 to 1.0) provides a normalized reading progress value suitable for SQLite persistence and OPDS Progression 1.0 synchronization.

---

## 5. Adapter API Contract (`FoliateReaderAdapter`)

Application code interacts exclusively with the `Reader` domain interface:

```typescript
const adapter = new FoliateReaderAdapter({
  container: document.getElementById("reader-mount")!,
  initialSettings: { theme: "light", fontSize: 18 },
});

// Load local EPUB Blob
await adapter.open(epubBlob);

// Navigation
await adapter.next();
await adapter.previous();
await adapter.goTo("epubcfi(/6/4[ch1]!/4/2/10)");

// Appearance
await adapter.setTheme("sepia"); // "light" | "dark" | "sepia"
await adapter.setFontSize(20);   // Clamped between 12 and 36 px

// Teardown
await adapter.close();
adapter.destroy();
```

---

## 6. Android WebView Compatibility Observations

1. **Custom Elements & Shadow DOM**: Fully supported by modern Android System WebView (Chrome 100+).
2. **Touch Turn Buttons & Gestures**: Large hit target overlay buttons (`‹` and `›`) provide reliable page turning on mobile screens.
3. **Viewport & Safe Areas**: Safe-area padding prevents header and footer controls from clipping behind system navigation or status bars.

---

## 7. Milestone M3: Production Reader Architecture

Milestone M3 advances the initial proof-of-concept into a production-grade reading core with strict separation of concerns.

### 7.1 State Machine Lifecycle
`FoliateReaderAdapter` enforces an explicit state lifecycle:
`uninitialized` ➔ `loading` ➔ `ready` ➔ `closing` ➔ `closed` / `destroyed` (with transitions to `error` on failure).
Concurrent calls or invalid transitions throw typed domain errors (`ReaderError`, `BookLoadError`, `NavigationError`, `UnsupportedFormatError`).

### 7.2 Dual-Format Compatibility (EPUB 2 & EPUB 3)
- **EPUB 3 (Nav Doc)**: Parsed from the package navigation document (`<nav epub:type="toc">`).
- **EPUB 2 (NCX)**: Automatically extracted from `toc.ncx` via Foliate's `parseNCX` parser when the OPF spine references `toc="ncx"`.
- **Hierarchical TOC**: Recursive normalization guarantees uniform `TocItem { id, label, href, subitems }` trees regardless of the underlying EPUB version.

### 7.3 Mobile Touch Ergonomics & Navigation
- **3-Zone Tap Surface**:
  - Left 20%: Previous page (`reader.previous()`)
  - Center 60%: Toggle immersive reading chrome (auto-hides header bar and bottom scrubber/controls)
  - Right 20%: Next page (`reader.next()`)
- **Touch Swipe Gestures**: Horizontal swipe detection (> 50px delta with minimal vertical drift) for natural page turns.
- **Iframe Keyboard Capture**: Key events inside the foliate reader iframe do not bubble across the document boundary. The adapter injects `keydown` forwarders onto section documents to capture `ArrowLeft`, `ArrowRight`, and `Space`.

### 7.4 Table of Contents (TOC) Slide-Out Drawer
- Accessible via the top toolbar or drawer menu.
- Renders hierarchical chapter lists with indentation.
- Tracks and highlights active section based on the current `relocate` event href.
- Closes automatically upon selecting a chapter.

### 7.5 Typography & Layout Controls
Extended typography configuration injected into the renderer stylesheet:
- **Font Families**: `sans-serif` (System default), `serif` (Literary), `monospace` (Code/technical).
- **Line Spacing**: `1.2`, `1.4`, `1.6`, `1.8`.
- **Margin Profiles**:
  - `narrow`: 12px horizontal padding (max text density for small mobile screens)
  - `normal`: 24px horizontal padding (balanced reading)
  - `wide`: 36px horizontal padding (tablet / reading focus)
- **Scrubbing**: Fractional progress slider allowing jumping directly across the book via `reader.goToFraction(fraction)`.

