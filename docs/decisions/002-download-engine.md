# ADR 002: Native Rust Download Engine

## Status
Accepted

## Context
Ebooks are multi-megabyte binary files. Downloading them through frontend JavaScript `fetch()` requires piping large `ArrayBuffer` chunks across the Tauri IPC bridge to save them to the filesystem, or giving the frontend broad filesystem write capabilities.

## Decision
Implement the book download engine in Rust (`src-tauri/src/downloads/` using `reqwest` and `tokio`).
The frontend simply invokes `download_book({ bookId, url, headers })` and receives progress events (`download://progress`).

## Consequences
- **Positive**: High throughput, direct-to-disk streaming without IPC memory amplification.
- **Positive**: True atomic writes (`.part` file validation then rename).
- **Positive**: Frontend does not need unrestricted filesystem write permissions.
- **Negative**: Download logic is split between Rust (engine) and TypeScript (UI/state triggers).
