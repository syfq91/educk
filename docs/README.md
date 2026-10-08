# Documentation Directory — educk

Welcome to the **educk** technical and architectural documentation directory.

---

## Architecture & System Design
- [product.md](product.md): Product vision, user flows, core MVP requirements, and out-of-scope features.
- [architecture.md](architecture.md): 7-layer architecture, component responsibilities, and Tauri IPC interfaces.
- [security.md](security.md): Threat modeling for untrusted EPUBs & OPDS feeds, iframe sandbox parameters, and CSP.
- [data-model.md](data-model.md): SQLite schema for sources, books, reading progress, sync states, and immutable migrations.
- [reader.md](reader.md): Foliate-js reader integration, shadow DOM architecture, and spike findings.
- [server-compatibility.md](server-compatibility.md): OPDS server heuristics, compatibility profiles, and normalization.
- [performance.md](performance.md): Performance budgets, startup marks, 60fps scrolling, and streaming memory architecture.
- [testing.md](testing.md): Testing tiers (Vitest, Cargo tests, fixtures, Android lifecycle).
- [e2e-testing.md](e2e-testing.md): Automated End-to-End Golden Path testing and standalone fake OPDS/progression server.

---

## Architecture Decision Records (ADRs)
- [001-reader-engine.md](decisions/001-reader-engine.md): Vendoring `foliate-js` via pinned submodule/checkout behind an adapter.
- [002-download-engine.md](decisions/002-download-engine.md): Native Rust download engine with atomic file validation.
- [003-storage-isolation.md](decisions/003-storage-isolation.md): Storage isolation and generated UUID paths against path traversal.

---

## Technical Research Notes
- [research/tauri.md](research/tauri.md): Tauri 2 Android capabilities, scoped storage, and asset protocols.
- [research/foliate.md](research/foliate.md): `foliate-js` architecture, `<foliate-view>` web component, and CFI positioning.
- [research/opds.md](research/opds.md): OPDS 1.2 Atom XML feeds, Dublin Core metadata, and authentication.
- [research/progression.md](research/progression.md): OPDS Progression 1.0 synchronization specification and conflict algorithm.

---

## Project Tracking
- [tasks.yaml](tasks.yaml): Machine-readable milestone and granular task tracker.
- [../educk-plan.md](../educk-plan.md): Master autonomous agent execution blueprint and phased plan.
