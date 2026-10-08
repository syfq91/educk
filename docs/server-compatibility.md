# OPDS 1.2 Ecosystem & Real-World Server Compatibility — educk

## Overview
While the OPDS 1.2 specification is based on the Atom Syndication Format (RFC 4287) and Dublin Core metadata, real-world open-source catalog servers exhibit vendor-specific quirks, non-standard MIME types, and tag variations.

To preserve codebase maintainability and prevent speculative workarounds from corrupting the core parser, `educk` implements a strict architectural separation:

```
[Raw OPDS 1.2 XML Feed]
        │
        ▼
[Standard Atom XML Parser] ──(Valid standard)──► [Raw Domain Model]
        │
    (Deviation)
        ▼
[Compatibility Normalizer Layer (compatibility.ts)]
        ├── Server Profile Detection (Calibre-Web, Komga, Kavita, Readarr)
        ├── MIME Type Normalization (x-epub, case, extensions)
        ├── Link Rel Standardization (shorthand, alternate-as-acquisition)
        ├── Dublin Core Tag Fallbacks (dc:creator, dc:date, dc:description)
        └── Author Normalization (unwrapped, delimited)
        │
        ▼
[Normalized Core OPDS Domain Model]
```

All server-specific workarounds are strictly isolated inside `src/services/opds/compatibility.ts`.

---

## Supported Server Profiles & Quirks Matrix

### 1. Calibre-Web
- **Server Identity**: Generator `<generator uri=".../calibre-web">Calibre-Web</generator>`, feed ID containing `calibre-web`, or presence of `opf:scheme="calibre"`.
- **Known Quirks**:
  - Emits `application/x-epub+zip` instead of standard `application/epub+zip`.
  - Authors stored in `<dc:creator opf:role="aut">` rather than `<author><name>`.
  - Multiple authors formatted with semicolons in composite strings (e.g. `Author A; Author B`).
  - Shorthand link rels: `rel="acquisition"`, `rel="cover"`, `rel="thumbnail"`.
  - Publication dates in `<dc:date>`.
- **Normalization Applied**:
  - `application/x-epub+zip` normalized to `application/epub+zip`.
  - `<dc:creator>` extracted and parsed into `OPDSPerson[]`.
  - Composite author strings split into individual authors.
  - Shorthand rels converted to canonical OPDS URIs (`http://opds-spec.org/acquisition`, `http://opds-spec.org/image`, `http://opds-spec.org/image/thumbnail`).

### 2. Komga
- **Server Identity**: Generator `<generator uri="https://komga.org">Komga</generator>`, feed URLs with `/opds/v1.2/`, or feed ID containing `komga`.
- **Known Quirks**:
  - Page-based pagination with query parameters (e.g. `?page=0&size=20`).
  - Generic `application/octet-stream` or `binary/octet-stream` MIME types on file download URLs ending in `.epub`.
  - Legacy `image/x-png` on cover images.
  - Comic/book mixed acquisition links.
- **Normalization Applied**:
  - Extracted pagination via `getNextPageLink(feed)` correctly preserved and resolved.
  - `application/octet-stream` on `.epub` URLs normalized to `application/epub+zip`.
  - `image/x-png` normalized to `image/png`.

### 3. Kavita
- **Server Identity**: Generator `<generator uri="https://kavitareader.com">Kavita</generator>` or feed URLs with `/api/opds/`.
- **Known Quirks**:
  - Unwrapped `<author>Author Name</author>` elements without child `<name>` element.
  - Uppercase MIME types (e.g. `APPLICATION/EPUB+ZIP`).
  - Parameterized MIME types (e.g. `application/epub+zip; charset=utf-8`).
  - Legacy `image/pjpeg` cover art.
- **Normalization Applied**:
  - Unwrapped text content of `<author>` tags recovered as author names.
  - MIME types converted to lowercase and parameter-stripped to `application/epub+zip`.
  - `image/pjpeg` normalized to `image/jpeg`.

### 4. Readarr
- **Server Identity**: Generator `<generator uri="https://readarr.com">Readarr</generator>` or feed ID containing `readarr`.
- **Known Quirks**:
  - Emits acquisition links as `rel="alternate"` pointing to `.epub` files (mimicking Calibre Content Server).
  - Uses `application/x-epub` MIME types.
  - Publication dates stored in `<dc:date>`.
- **Normalization Applied**:
  - `rel="alternate"` links pointing to `.epub` files promoted to `http://opds-spec.org/acquisition/open-access` with `type="application/epub+zip"`.
  - `application/x-epub` normalized to `application/epub+zip`.
  - `<dc:date>` extracted as `entry.published` and `entry["dcterms:issued"]`.

---

## Configuration & Strict Mode

Compatibility normalization is enabled by default in `OPDSClient`:

```typescript
const client = new OPDSClient({
  enableCompatibility: true, // default
});
```

To enforce strict, un-normalized RFC 4287 / OPDS 1.2 parsing (e.g. for spec conformance testing), pass `enableCompatibility: false`:

```typescript
const strictClient = new OPDSClient({
  enableCompatibility: false,
});
```
