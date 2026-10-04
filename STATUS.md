# Current Status

**Current Milestone**: M1 — Project Bootstrap & Verification (Complete)

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
  - Created minimal mobile application shell:
    - Home screen with empty library state
    - Navigation placeholder with bottom bar (Library, Catalogs, Settings)
    - Application version display querying Rust Tauri command (`get_app_version`)
    - Dark and light responsive themes
  - Verified compilation and built Android Debug APK (`src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`).

---

## In Progress
- Milestone M2 preparation: Foliate-js Android proof-of-concept spike.

---

## Blocked
None.

---

## Known Issues
None.

---

## Next Task
- **Milestone M2 (Foliate-js Android Proof of Concept)**:
  1. Pin and vendor `foliate-js` under `vendor/foliate-js`.
  2. Implement minimal ReaderAdapter spike.
  3. Load test EPUB fixture and verify rendering, page navigation, and CFI extraction in WebView.
  4. Verify strict CSP blocks ebook JavaScript from accessing Tauri/browser APIs.

---

## Verification Summary
- **TypeScript (`pnpm run typecheck`)**: PASS
- **ESLint (`pnpm run lint`)**: PASS
- **Unit Tests (`pnpm test`)**: PASS (1/1 tests)
- **Frontend Build (`pnpm run build`)**: PASS
- **Rust Cargo Check (`cargo check`)**: PASS
- **Rust Clippy (`cargo clippy`)**: PASS (0 warnings)
- **Android Target Build (`tauri android build --apk`)**: PASS (`app-universal-debug.apk` generated)
