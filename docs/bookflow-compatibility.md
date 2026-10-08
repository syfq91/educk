# BookFlow Compatibility Report

**Target Server:** [syfq91/bookflow](https://github.com/syfq91/bookflow)  
**Client:** educk (Android DRM-free ebook reader)  
**Specifications Verified:** OPDS 1.2 Catalog Specification & OPDS Progression 1.0  

---

## 1. Executive Summary

A comprehensive architectural and protocol audit was conducted between `educk` and `syfq91/bookflow`. BookFlow is a modern Python/Flask OPDS server providing OPDS 1.2 catalog feeds, device-optimized EPUB conversions (X3/X4 profiles), and native OPDS Progression 1.0 synchronization.

All OPDS catalog browsing, authentication, and progression synchronization endpoints are **100% compatible and verified** with automated tests.

---

## 2. Compatibility Matrix

| Concern | Feature / Endpoint | BookFlow Specification | educk Support | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Authentication** | Root & Catalog Endpoints | HTTP Basic Auth; returns 401 with `application/opds-authentication+json` and `WWW-Authenticate: Basic realm="BookFlow"` | Basic Auth credentials configured in `SourceRepository` sent as base64 `Authorization: Basic ...` | **Compatible** |
| **Authentication** | Unconfigured Server | Returns 503 (`OPDS is disabled: set OPDS_ADMIN_PASSWORD`) | Throws friendly network error | **Compatible** |
| **Catalog** | Root Feed (`/opds`) | Atom navigation feed (`application/atom+xml;profile=opds-catalog;kind=navigation`), links to folders, `/opds/books`, `/opds/recent`, `/opds/authors`, `/opdsx3`, `/opdsx4` | `OPDSClient.fetchFeed` parses navigation feeds, subfolder entries, and catalog mirrors | **Compatible** |
| **Catalog** | Acquisition Feed (`/opds/books`) | Paginated Atom acquisition feed (50 books/page) with `rel="next"` | `OPDSClient.getNextPageLink` automatically detects next page links | **Compatible** |
| **Catalog** | OpenSearch (`/opds/search?q={searchTerms}`) | `rel="search"` OpenSearch template in every feed | `OPDSClient.getSearchLink` extracts template and binds query parameter `q` | **Compatible** |
| **Acquisition** | Standard EPUB Downloads (`/opds/download/<id>`) | Direct streaming of DRM-free EPUB (`application/epub+zip`) | Atomic download (`.epub.part` -> validation -> `.epub`) into sandboxed storage | **Compatible** |
| **Acquisition** | Device Downloads (`/opdsx3/download/<id>`, `/opdsx4/download/<id>`) | On-demand epubkit optimization cached in server | Full EPUB validation and download support | **Compatible** |
| **Images** | Covers & Thumbnails (`/opds/cover/<id>`) | JPEG covers on demand (`image/jpeg`) | `OPDSClient.getCoverLink` & `getThumbnailLink` load and cache covers | **Compatible** |
| **Discovery** | Progression Link | `rel="http://opds-spec.org/progression"` with `type="application/opds-progression+json"` on every book entry | `OPDSClient.getProgressionLink` discovers and registers URL in `sync_state` | **Compatible** |
| **Progression GET** | Stored Progression | Returns `200 OK` with JSON document (`modified`, `progression`, `device: {id, name}`, `title`, `references`) | `ProgressionClient.getProgression` parses and normalizes into `RemoteProgressionPayload` | **Compatible** |
| **Progression GET** | Unread Publication | Returns `200 OK` with empty body (`b""`) and `application/opds-progression+json` | Handled gracefully as `null` (no progress saved yet) | **Compatible** |
| **Progression GET** | Missing Publication | Returns `404 Not Found` with RFC 7807 problem details | Returns `null` without retry | **Compatible** |
| **Progression PUT** | Payload & Content-Type | Requires `Content-Type: application/opds-progression+json`, `modified`, `progression` (0.0–1.0), and `device: {id, name}` | `ProgressionClient.putProgression` provides dual-format JSON with all required fields | **Compatible** |
| **Progression PUT** | Created / Updated | Returns `201 Created` or `200 OK` with stored document | Interpreted as successful push | **Compatible** |
| **Progression Conflict** | Stale Client Timestamp | Returns `409 Conflict` with RFC 7807 problem details (`https://registry.opds.io/error#progression-date`) | `ProgressionConflictError` immediately triggers remote fetch and conflict prompt | **Compatible** |
| **Server Profile** | Heuristic Detection | Feed ID starts with `tag:bookflow,...` | `detectServerProfile` identifies `"bookflow"` | **Compatible** |

---

## 3. Discrepancies Identified & Resolved

During the investigation, several subtle protocol details were identified and addressed in `educk`:

1. **MIME Type Strictness**:
   - *BookFlow Behavior*: BookFlow validates `request.mimetype == "application/opds-progression+json"` on PUT requests, explicitly rejecting generic `application/json` with HTTP 400 (`progression-invalid-payload`).
   - *Fix*: `ProgressionClient` sets `Content-Type: application/opds-progression+json` and `Accept: application/opds-progression+json, application/json;q=0.9, */*;q=0.8`.

2. **Progression Document Schema**:
   - *BookFlow Behavior*: BookFlow requires top-level `progression: float` (0.0 to 1.0) and `device: { id: string, name: string }`.
   - *Readium Draft Behavior*: Readium uses `locator: { locations: { totalProgression: float } }` and string `device`.
   - *Dual-Format Solution*: `educk` now sends a superset payload containing both BookFlow required fields (`progression`, `device: { id, name }`, `title`, `references`) and standard Readium `locator`. BookFlow parses its expected fields and ignores extra keys; Readium readers parse `locator`. On ingest (GET), `normalizeProgressionPayload` transparently extracts progression from either schema.

3. **HTTP 200 with Empty Body for Unread Books**:
   - *BookFlow Behavior*: When a publication has not been read by the user yet, BookFlow returns HTTP 200 with an empty body (`b""`) rather than 404.
   - *Fix*: `ProgressionClient` checks `!text || !text.trim()`, returning `null` cleanly instead of throwing a JSON parse error.

4. **HTTP 409 Conflict Handling**:
   - *BookFlow Behavior*: When a client submits a timestamp older than the server's record, BookFlow responds with HTTP 409 (`https://registry.opds.io/error#progression-date`).
   - *Fix*: `ProgressionClient` throws `ProgressionConflictError` immediately without retrying, and `ProgressionSyncManager` retrieves the newer remote position to present a conflict prompt to the user.

5. **Server Profile Recognition**:
   - Added `"bookflow"` to `ServerProfile` in `src/domain/opds.ts` and heuristic detection for `tag:bookflow` feeds in `src/services/opds/compatibility.ts`.

---

## 4. Verification

All behaviors have been verified with automated unit tests in `tests/unit/bookflow-compatibility.test.ts`:
- Parsing BookFlow root navigation feed with subfolders and OpenSearch template
- Parsing BookFlow acquisition feed with download, cover, and progression links
- GET and normalization of BookFlow progression documents
- GET handling of 200 OK with empty body
- PUT progression with `application/opds-progression+json` and BookFlow device object
- Immediate HTTP 409 conflict detection and resolution
- Cold-open progression pull into local SQLite database
- Active session conflict prompt triggering
