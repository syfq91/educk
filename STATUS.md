# Current Status

**Current Milestone**: M1 — Project Bootstrap & Verification (M0 Complete)

---

## Completed
- Tauri 2 + Vanilla TypeScript skeleton scaffolded
- Git version control initialized (`main` branch)
- Project governance and development rules established:
  - [AGENTS.md](file:///home/syafiq/code/educk/AGENTS.md): Architectural boundaries, security directives, core rules
  - [CLAUDE.md](file:///home/syafiq/code/educk/CLAUDE.md): Agent operational guidelines & verification checklist
  - [STATUS.md](file:///home/syafiq/code/educk/STATUS.md): Machine & human readable tracking
  - [docs/tasks.yaml](file:///home/syafiq/code/educk/docs/tasks.yaml): Machine-readable milestone status
- **Milestone M0 (Reconnaissance & Architecture)**:
  - [docs/research/tauri.md](file:///home/syafiq/code/educk/docs/research/tauri.md): Tauri 2 Android capabilities & filesystem storage
  - [docs/research/foliate.md](file:///home/syafiq/code/educk/docs/research/foliate.md): foliate-js modules, adapter pattern, and sandboxing
  - [docs/research/opds.md](file:///home/syafiq/code/educk/docs/research/opds.md): OPDS 1.2 specifications, XML safety, and feed types
  - [docs/research/progression.md](file:///home/syafiq/code/educk/docs/research/progression.md): OPDS Progression 1.0 sync and conflict algorithm
  - [docs/product.md](file:///home/syafiq/code/educk/docs/product.md): Product scope, MVP boundaries, non-goals
  - [docs/architecture.md](file:///home/syafiq/code/educk/docs/architecture.md): 7-layer architecture and Tauri IPC boundaries
  - [docs/security.md](file:///home/syafiq/code/educk/docs/security.md): Threat model, CSP rules, script execution prevention
  - [docs/data-model.md](file:///home/syafiq/code/educk/docs/data-model.md): SQLite schema and migration policy
  - [docs/testing.md](file:///home/syafiq/code/educk/docs/testing.md): Testing tiers, negative test matrix, and lifecycle tests
  - Architecture Decision Records:
    - [ADR 001: Vendoring foliate-js](file:///home/syafiq/code/educk/docs/decisions/001-reader-engine.md)
    - [ADR 002: Native Rust Download Engine](file:///home/syafiq/code/educk/docs/decisions/002-download-engine.md)
    - [ADR 003: Storage Isolation and UUID Paths](file:///home/syafiq/code/educk/docs/decisions/003-storage-isolation.md)
- `pnpm install` completed successfully (resolved and installed frontend packages)
- TypeScript build check passed (`pnpm run build`)

---

## In Progress
- Rust Cargo check compiling crate dependencies.
- Configuring Vitest, ESLint, and testing infrastructure for Milestone M1.

---

## Blocked
None.

---

## Known Issues
None.

---

## Next Task
- Complete baseline Rust check (`cargo check`).
- Configure linting and unit test runner (`vitest`, `@eslint/js`, `typescript-eslint`).
- Prepare Phase 2 (Foliate-js Android proof-of-concept spike).

---

## Verification
- **Frontend Build (`tsc && vite build`)**: PASS
- **Rust Cargo Check**: RUNNING (compiling dependencies)
- **Node**: v24.21.0
- **pnpm**: 12.8.1
- **Cargo**: 1.99.0
