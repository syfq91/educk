# foliate-js Research & Integration Spike Plan

## Overview
`foliate-js` is a lightweight, zero-dependency JavaScript ebook rendering engine originally developed for the Foliate desktop application. It supports EPUB (2 and 3), Kindle (MOBI, AZW, AZW3), comic archives (CBZ/CBR), and FB2.

## Key Modules
- **`view.js`**: Defines the `<foliate-view>` web component that handles pagination, continuous scrolling, column layout, resize handling, and page turning.
- **`epub.js`**: Parses EPUB container files (`META-INF/container.xml`, `.opf` package documents, navigation documents `toc.ncx` / Nav Doc).
- **`epubcfi.js`**: Full support for EPUB Canonical Fragment Identifiers (CFI) for exact positional referencing and bookmarks.
- **`opds.js`**: Basic OPDS 1.x parser and OpenSearch description parser.
- **`comic-book.js`**, **`fb2.js`**: Format parsers for secondary formats.

## foliate-view API & Lifecycle
1. **Initialization**:
   ```javascript
   const view = document.createElement('foliate-view');
   container.appendChild(view);
   await view.open(book); // book is created from makeBook(fileOrLoader)
   ```
2. **Navigation**:
   - `view.next()`: Go to next screen/page.
   - `view.prev()`: Go to previous screen/page.
   - `view.goTo(cfiOrHref)`: Navigate to a specific CFI or chapter URL.
3. **Relocation & Position**:
   - Event: `relocate` emits `{ cfi, fraction, location, tocItem }`.
   - `fraction`: 0.0 to 1.0 representing overall book progression percentage.
   - `cfi`: Standard EPUB CFI string representing precise position.
4. **Rendering & Layout Settings**:
   - Setting layout (paginated vs scrolled).
   - Setting font size, font family, line height, margins.
   - Overriding styles via custom CSS injections or CSS variables (light/dark/sepia).

## Stability & Vendoring Strategy
- Upstream explicitly notes that `foliate-js` has no stable npm release and APIs can evolve.
- **Strategy**:
  - Pinned Git submodule or vendored snapshot in `vendor/foliate-js`.
  - Application code NEVER imports from `vendor/foliate-js` directly.
  - Encapsulated behind `src/services/reader/FoliateReaderAdapter.ts` conforming to `Reader` interface (`src/domain/reader.ts`).

## Security & Script Execution
- Foliate renders content in an internal sandboxed `<iframe>`.
- Untrusted EPUBs may attempt XSS or exploit WebView bridges.
- **Enforcement**:
  - Ebook JavaScript MUST remain disabled.
  - Ensure `sandbox` attributes on the rendering iframe omit `allow-scripts`.
  - Enforce Content Security Policy prohibiting remote network calls and script execution from within the book context.
