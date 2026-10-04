# educk 🦆

> A lightweight, privacy-preserving Android DRM-free ebook reader built with Tauri 2, TypeScript, Rust, foliate-js, SQLite, OPDS 1.2, and OPDS Progression 1.0.

[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)
[![Tauri 2](https://img.shields.io/badge/Tauri-v2-orange.svg)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-2021-red.svg)](https://www.rust-lang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## Highlights

- **Download-First & Offline-Reliable**: Books are downloaded completely before reading; reading never halts on network connectivity.
- **DRM-Free by Design**: Strictly DRM-free for complete ownership of your reading library. Primary format is EPUB (EPUB 2 & 3).
- **Engineered Security**: Untrusted ebook content (EPUB) is sandboxed with strict Content Security Policy (`script-src 'none'`), disabled ebook JavaScript, and zero access to Tauri or filesystem IPC.
- **Open Protocols**: Browse and acquire from OPDS 1.2 feeds; synchronize reading positions seamlessly via OPDS Progression 1.0.
- **Native Performance**: Native Rust download engine streaming directly to disk with atomic validation and SQLite local state.

---

## Architecture Overview

`educk` enforces strict separation of concerns across 7 layers:

```
[UI Layer: Mobile Shell, Library, Catalogs, Settings]
         │
         ├── [OPDS Client (Atom XML Parser)]
         ├── [Library Manager (SQLite Local Store)]
         ├── [Reader Abstraction -> foliate-js Adapter]
         └── [Progression Synchronization (OPDS Progression 1.0)]
         │
  [Tauri IPC Boundary]
         │
         ├── [Rust Native Download Engine (reqwest + tokio)]
         └── [Rust SQLite Native Store & App-Scoped Storage]
```

See [docs/architecture.md](docs/architecture.md) for full architectural details.

---

## Project Documentation Index

- [STATUS.md](STATUS.md) — Live project status, current milestone, and verification summary
- [AGENTS.md](AGENTS.md) — Engineering rules, boundaries, and quality requirements
- [CLAUDE.md](CLAUDE.md) — Operational instructions and autonomous agent handbook
- [educk-plan.md](educk-plan.md) — Master autonomous agent execution blueprint and phased plan
- [docs/product.md](docs/product.md) — Product requirements, user flows, and non-goals
- [docs/architecture.md](docs/architecture.md) — System architecture and layer boundaries
- [docs/security.md](docs/security.md) — Threat model, CSP, and sandboxing specifications
- [docs/data-model.md](docs/data-model.md) — SQLite schema, relations, and migration policies
- [docs/testing.md](docs/testing.md) — Testing strategy, fixture matrix, and Android lifecycle tests
- [docs/decisions/](docs/decisions/) — Architecture Decision Records (ADRs)
- [docs/research/](docs/research/) — Research reports on Tauri 2 Android, foliate-js, OPDS 1.2, and Progression

---

## Development & Verification

### Prerequisites
- Node.js (v20+) & [pnpm](https://pnpm.io/)
- Rust (1.80+) & Cargo
- Android SDK & NDK (for mobile builds)

### Common Commands

```bash
# Install frontend dependencies
pnpm install

# Run unified checks (typecheck + lint + test)
pnpm run check

# Run TypeScript typechecker
pnpm run typecheck

# Run ESLint
pnpm run lint

# Run unit tests
pnpm test

# Build frontend assets
pnpm run build

# Check Rust backend
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

# Build Android Debug APK
pnpm tauri android build --debug --apk --target aarch64
```
