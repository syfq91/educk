# Current Status

**Current Milestone**: M2 — Foliate-js Android Proof of Concept (Complete)

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
  - Built interactive mobile reader spike view in frontend shell with page turns, live CFI display, font sizing, and theme switching (Light, Dark, Sepia).
  - Documented integration findings in [docs/reader.md](file:///home/syafiq/code/educk/docs/reader.md) and updated [docs/decisions/001-reader-engine.md](file:///home/syafiq/code/educk/docs/decisions/001-reader-engine.md).
  - Implemented automated test suites: `reader-vendor.test.ts`, `epub-fixture.test.ts`, `reader-adapter.test.ts`, `security-sandbox.test.ts` (16/16 tests passing).

---

## In Progress
- Milestone M3 preparation: Production Reader Core Abstraction.

---

## Blocked
None.

---

## Known Issues
None.

---

## Next Task
- **Milestone M3 (Production Reader Core Abstraction)**:
  1. Mature `FoliateReaderAdapter` with robust lifecycle management, event bus, and error handling.
  2. Implement comprehensive Table of Contents (TOC) navigation modal.
  3. Support dual-format EPUB 2 (NCX) and EPUB 3 (Nav Doc) navigation structures.
  4. Implement reading percentage and page number calculations across screen resize events.

---

## Verification Summary
- **TypeScript (`pnpm run typecheck`)**: PASS
- **ESLint (`pnpm run lint`)**: PASS
- **Unit Tests (`pnpm test`)**: PASS (16/16 tests across 5 test suites)
- **Frontend Build (`pnpm run build`)**: PASS (`dist/` generated)
- **Rust Cargo Check (`cargo check`)**: PASS
- **Rust Clippy (`cargo clippy`)**: PASS (0 warnings)
- **Android Target Build**: PASS
