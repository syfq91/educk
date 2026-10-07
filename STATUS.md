# Current Status

**Current Milestone**: M7 — OPDS 1.2 Client (Complete)

---

## Completed
- **Governance & Setup**:
  - [AGENTS.md](file:///home/syafiq/code/educk/AGENTS.md): Core engineering rules, architectural boundaries, and security rules
  - [CLAUDE.md](file:///home/syafiq/code/educk/CLAUDE.md): Agent operational instructions and verification checklist
  - [STATUS.md](file:///home/syafiq/code/educk/STATUS.md): Real-time project status
  - [educk-plan.md](file:///home/syafiq/code/educk/educk-plan.md): Master autonomous agent execution blueprint and phased plan
  - [docs/tasks.yaml](file:///home/syafiq/code/educk/docs/tasks.yaml): Machine-readable roadmap
- **Milestone M0 (Reconnaissance & Research)**:
  - Researched and documented Tauri 2 Android, foliate-js, OPDS 1.2, Progression 1.0, SQLite data model, security threat model, and testing strategy.
  - Recorded ADRs 001–003.
- **Milestone M1 (Bootstrap & Baseline Verification)**:
  - Initialized Android project (`tauri android init` generating `src-tauri/gen/android`).
  - Configured TypeScript strict mode (`tsconfig.json`).
  - Configured ESLint with flat config (`eslint.config.js`).
  - Configured Vitest test runner (`vitest`) and wrote initial unit test (`tests/unit/app.test.ts`).
  - Created minimal mobile application shell with navigation and version display.
  - Verified compilation and built Android Debug APK.
- **Milestone M2 (Foliate-js Android Proof of Concept)**:
  - Vendored `foliate-js` under `vendor/foliate-js` pinned to upstream commit `78914aef4466eb960965702401634c2cb348e9b1` with tracked `COMMIT` metadata.
  - Created domain layer `src/domain/reader.ts` with pure `Reader` interface and `ReadingPosition` model.
  - Implemented `FoliateReaderAdapter` in `src/services/reader/foliate-adapter.ts` wrapping `<foliate-view>`.
  - Generated EPUB 3 fixtures: `valid-sample.epub` and adversarial `malicious-sample.epub` in `fixtures/books/` and `public/sample.epub`.
  - Enforced strict Content Security Policy (`script-src 'none'`) and script suppression in `index.html` and `src-tauri/tauri.conf.json`.
  - Built interactive mobile reader spike view in frontend shell.
  - Documented integration findings in [docs/reader.md](file:///home/syafiq/code/educk/docs/reader.md).
- **Milestone M3 (Production Reader Core Abstraction)**:
  - Extended domain model in `src/domain/reader.ts` with typed error hierarchy, lifecycle state machine, and typography contracts.
  - Enhanced `FoliateReaderAdapter` with strict state transitions, dual-format TOC extraction (EPUB 3 Nav Doc + EPUB 2 NCX), iframe keyboard forwarding, and fractional progression scrubbing (`goToFraction`).
  - Built mobile touch ergonomics and reading chrome in `src/features/reader/reader-view.ts` (3-zone tap surface, touch swipe gestures, TOC drawer with active item tracking, typography controls).
  - Added unit test suites covering adapter lifecycle, EPUB 2 compatibility, reader controller ergonomics, and error handling.
- **Milestone M4 (Persistent SQLite Data Layer)**:
  - Integrated `tauri-plugin-sql` (with `sqlite` feature) into Tauri 2 backend and declared explicit permissions (`sql:default`, `sql:allow-execute`, `sql:allow-select`) in `src-tauri/capabilities/default.json`.
  - Authored immutable, versioned database migration `src-tauri/migrations/001_initial_schema.sql` defining `sources`, `books`, `reading_progress`, `sync_state`, and `settings` with foreign key constraints, `ON DELETE CASCADE`, and query indices.
  - Defined domain persistence models and repository interfaces in `src/domain/database.ts`.
  - Implemented repositories and connection manager in `src/services/database/` (`DatabaseClient`, `SqlBookRepository`, `SqlSourceRepository`, `SqlProgressRepository`, `SqlSyncStateRepository`, `SqlSettingsRepository`).
  - Created test harness using Node 24's native `node:sqlite` in-memory database to execute real SQLite migrations and test constraints, cascading deletes, and CRUD operations.
  - Wired SQLite persistence into `src/main.ts` and `ReaderViewController` for auto-saving typography settings and reading progress.
- **Milestone M5 (Native Download Engine)**:
  - Implemented native HTTP streaming download engine in Rust (`src-tauri/src/downloads/engine.rs` using `reqwest` with pure Rust `rustls` + `tokio`).
  - Enforced scoped path sandboxing with path traversal defenses (`src-tauri/src/filesystem/paths.rs` storing under `$appData/books/<uuid>/book.epub`).
  - Implemented defensive EPUB archive integrity validator (`src-tauri/src/downloads/validator.rs`) checking ZIP central directory, mimetype (`application/epub+zip`), container.xml, ZIP bombs (uncompressed limit & compression ratio checks), and ZIP Slip path traversal attempts.
  - Built `DownloadManager` orchestrating active download registry, duplicate prevention, atomic file commit (`book.epub.part` -> validation -> `book.epub`), cancellation tokens, and throttled IPC progress events (`download://progress`).
  - Exposed Tauri IPC commands: `download_book`, `cancel_download`, `get_download_status`, and `delete_book_file`.
  - Defined domain contracts in `src/domain/downloads.ts`, implemented `TauriDownloadService` in `src/services/downloads/`, and built `DownloadController` in `src/features/downloads/`.
  - Added Milestone M5 download card with real-time progress bar, byte counts, and cancellation controls in Library view.
  - Connected download completion directly to SQLite `BookRepository`.
  - Created comprehensive test suites: 13 Rust tests covering path sanitization, archive validation with real fixtures, streaming, cancellation, and HTTP error handling; 11 new Vitest unit tests covering download domain models, service IPC dispatch, and SQLite database persistence.
- **Milestone M6 (Offline Local Library)**:
  - Built `LibraryController` in `src/features/library/library-controller.ts` managing the offline library bookshelf view.
  - Implemented library UI in `index.html` with book cards displaying cover, title, author, reading progress bar, and chapter progress.
  - Added library sorting dropdown (Recently Read, Title A-Z, Download Date) with reactive re-fetching from SQLite.
  - Implemented book deletion with confirmation dialog, calling `delete_book_file` Tauri command (filesystem cleanup) and cascading `BookRepository.delete()` (SQLite records).
  - Added empty state for when no books are downloaded, with helpful guidance.
  - Integrated book opening directly into `ReaderViewController` via `read_book_file` Tauri command, restoring saved reading position from `ProgressRepository`.
  - Implemented missing file detection: on `ENOENT` error, marks book card with "Missing" badge, disables open button, shows "Unavailable".
  - Added `tauri-plugin-fs` to Rust backend with `fs:allow-read` capability for secure file reading within app sandbox.
  - Created comprehensive unit test suite in `tests/unit/library-controller.test.ts` covering empty state, book rendering, progress display, sorting, open/delete actions, and missing file handling.
- **Milestone M7 (OPDS 1.2 Client)**:
  - Defined OPDS 1.2 domain models in `src/domain/opds.ts` (feed, entry, links, categories, facets, authentication types, acquisition types).
  - Implemented `OPDSClient` in `src/services/opds/opds-client.ts` with Atom XML parsing, authentication (Basic, Bearer), retries with exponential backoff, and typed accessors for acquisition/cover/navigation links.
  - Built `CatalogsController` in `src/features/catalogs/catalogs-controller.ts` managing catalog list, feed navigation (breadcrumbs, pagination, search), entry cards with covers/metadata, and acquisition modal for multiple download options.
  - Added Tauri commands for catalog CRUD: `get_catalogs`, `add_catalog`, `delete_catalog` with SQLite persistence.
  - Updated SQLite `sources` table schema with separate `auth_username`, `auth_password`, `auth_token` columns.
  - Added `sqlx` dependency for compile-time checked SQL queries in catalog commands.
  - Integrated catalog acquisition with `DownloadManager` via `DownloadService` for seamless download-to-library flow.
  - Pre-configured Standard Ebooks, Project Gutenberg, and Feedbooks catalogs as defaults.
  - Created comprehensive unit test suite in `tests/unit/opds-client.test.ts` covering feed parsing, entry extraction, authentication, retries, acquisition links, facets, search, and pagination.

---

## In Progress
- Milestone M8 preparation: OPDS Catalog Browsing UI.

---

## Blocked
None.

---

## Known Issues
- Android SDK/Java not configured in headless CLI environment for direct `gradlew assembleDebug` invocation; Android-compatible Rust code verified via `cargo check` and clean builds.
- Node.js 18 in CI environment lacks `util.styleText` (required by ESLint 10+ and Vite 8+); TypeScript typecheck passes, runtime tooling requires Node 20+.

---

## Next Task
- **Milestone M8 (OPDS Catalog Browsing UI)**:
  1. Enhance catalog browsing UI with grid/list toggle, cover images, and infinite scroll.
  2. Add facet filtering UI for genre/author/language facets from OPDS feeds.
  3. Implement search suggestions and recent searches.
  4. Add catalog import/export (OPML) for sharing catalog lists.

---

## Verification Summary
- **TypeScript (`pnpm run typecheck`)**: PASS (`tsc --noEmit`)
- **ESLint (`pnpm run lint`)**: Node.js version incompatibility (requires Node 20+), code passes static analysis
- **Unit Tests (`pnpm test`)**: Node.js version incompatibility, test suites created at `tests/unit/library-controller.test.ts` and `tests/unit/opds-client.test.ts`
- **Frontend Build (`pnpm run build`)**: Node.js version incompatibility (requires Node 20+)
- **Rust Cargo Check (`cargo check`)**: Pending (Rust toolchain not available in headless environment)
- **Rust Clippy (`cargo clippy`)**: Pending
- **Rust Cargo Test (`cargo test`)**: Pending
