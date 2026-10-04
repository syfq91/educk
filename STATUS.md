# Current Status

**Current Milestone**: M3 — Production Reader Core Abstraction (Complete)

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
  - Extended domain model in `src/domain/reader.ts` with typed error hierarchy (`ReaderError`, `BookLoadError`, `NavigationError`, `UnsupportedFormatError`), lifecycle state machine, and typography contracts.
  - Enhanced `FoliateReaderAdapter` with strict state transitions, dual-format TOC extraction (EPUB 3 Nav Doc + EPUB 2 NCX), iframe keyboard forwarding, and fractional progression scrubbing (`goToFraction`).
  - Built mobile touch ergonomics and reading chrome in `src/features/reader/reader-view.ts`:
    - 3-zone tap surface (previous 20%, toggle chrome 60%, next 20%).
    - Touch swipe navigation (> 50px delta with minimal vertical drift).
    - Table of Contents (TOC) slide-out drawer with hierarchical tree and active chapter tracking.
    - Advanced typography controls (font families: sans-serif/serif/monospace, line spacing 1.2–1.8, margins: narrow/normal/wide).
    - Fractional progress scrub slider.
  - Generated fixtures: `fixtures/books/valid-epub2.epub`, `fixtures/books/corrupted-invalid-zip.epub`, `fixtures/books/corrupted-missing-container.epub`, and `public/sample-epub2.epub`.
  - Added unit test suites covering adapter lifecycle, EPUB 2 compatibility, reader controller ergonomics, and error handling (32/32 tests passing across 8 test suites).

---

## In Progress
- Milestone M4 preparation: Persistent SQLite Data Layer.

---

## Blocked
None.

---

## Known Issues
None.

---

## Next Task
- **Milestone M4 (Persistent SQLite Data Layer)**:
  1. Add `tauri-plugin-sql` and SQLite driver in Rust/Cargo dependencies.
  2. Implement versioned database migrations (`001_initial_schema.sql` for books, feeds, sync progress, and settings).
  3. Create repositories for book metadata, reading progress, and reader preferences.
  4. Implement integration tests for SQLite persistence and offline recovery.

---

## Verification Summary
- **TypeScript (`pnpm run typecheck`)**: PASS (`tsc --noEmit`)
- **ESLint (`pnpm run lint`)**: PASS
- **Unit Tests (`pnpm test`)**: PASS (32/32 tests across 8 test suites)
- **Frontend Build (`pnpm run build`)**: PASS (`dist/` generated)
- **Rust Cargo Check (`cargo check`)**: PASS
- **Rust Clippy (`cargo clippy`)**: PASS (0 warnings)
- **Android Target Build**: PASS (Universal Debug APK built at `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`)
