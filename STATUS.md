# Current Status

**Current Milestone**: M4 — Persistent SQLite Data Layer (Complete)

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

---

## In Progress
- Milestone M5 preparation: Native Download Engine.

---

## Blocked
None.

---

## Known Issues
None.

---

## Next Task
- **Milestone M5 (Native Download Engine)**:
  1. Implement native HTTP download engine in Rust (`src-tauri/src/downloads/` using `reqwest` + `tokio`).
  2. Implement atomic file commit: `book.epub.part` -> archive verification -> atomic rename to `book.epub`.
  3. Emit download progress events (`download://progress`) over Tauri IPC.
  4. Enforce path sandboxing (`$appData/books/<generated-id>/book.epub`).
  5. Connect download completion to `BookRepository` in SQLite.

---

## Verification Summary
- **TypeScript (`pnpm run typecheck`)**: PASS (`tsc --noEmit`)
- **ESLint (`pnpm run lint`)**: PASS
- **Unit Tests (`pnpm test`)**: PASS (67/67 tests across 15 test suites)
- **Frontend Build (`pnpm run build`)**: PASS (`dist/` generated)
- **Rust Cargo Check (`cargo check`)**: PASS
- **Rust Clippy (`cargo clippy`)**: PASS (0 warnings)
- **Rust Cargo Test (`cargo test`)**: PASS (1/1 Rust test passed)
- **Android Target Build**: PASS (Universal Debug APK built at `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`)
