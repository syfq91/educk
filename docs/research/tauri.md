# Tauri 2 Android Research & Architecture Notes

## Overview
Tauri 2 provides multi-platform support including Android via a native WebView wrapper (`android.webkit.WebView`). Rust handles backend logic and communicates with the web frontend via an asynchronous IPC channel (`invoke` and events).

## Filesystem on Android
- **App Storage Isolation**: On Android, apps run with restricted sandboxed storage. Application data directories (`$APPDATA`, `$APPCACHE`, `$APPLOCALDATA`) are internal to the app's UID and private to the application.
- **Tauri Plugins**:
  - `@tauri-apps/plugin-fs` & `tauri-plugin-fs`: Provides scoped filesystem operations from frontend or Rust.
  - In our architecture, **file writing/reading of book data and SQLite is managed primarily in Rust** to avoid exposing raw filesystem capabilities to the frontend or untrusted book contexts.
- **Atomic Writes**: Native Rust file operations can atomically write to `<book-id>/book.epub.part` and rename to `book.epub` upon successful checksum/EPUB validation.
- **Asset Serving & Protocol**:
  - Tauri uses custom protocol schemes (e.g., `asset://` or `tauri://localhost` or `http://tauri.localhost` / `https://tauri.localhost`) to serve application assets.
  - Serving local EPUB files to the webview: We can register a custom URI protocol or use Tauri's asset protocol with strict origin restrictions, or stream book resources through an in-memory/blob URL or custom protocol handler in Rust.

## HTTP & Download Management
- **Plugins**: `@tauri-apps/plugin-http` & `tauri-plugin-http` / Rust `reqwest`
- **Native Rust Downloads**:
  - Recommended architecture: Native download engine implemented directly in Rust using `reqwest` + `tokio`.
  - Benefits: Background downloads, streaming directly to disk without passing multi-megabyte binary chunks over the Tauri IPC serialization boundary, resume/range support, cancellation tokens, and progress event emission (`download://progress`).

## Capabilities & Permissions (Tauri 2 Security Model)
- Tauri 2 replaces the v1 allowlist with an explicit capability and permission system:
  - Permissions are declared in `src-tauri/capabilities/`.
  - Scopes limit directory access (e.g. `$APPDATA/books/**`).
  - Ebook rendering frames must have **NO** permissions assigned.
  - Window or iframe hosting ebook content must have no Tauri IPC injected (`withGlobalTauri: false` or isolated iframe context).

## Key Risks & Mitigations
1. **Android WebView Compatibility**: Foliate-js relies on modern DOM APIs (e.g., CSS multi-column layout, Custom Elements, ResizeObserver).
   - *Mitigation*: Modern Android System WebView (Chrome 100+) supports all required APIs. Android 7.0+ allows WebView updates via Google Play.
2. **IPC Overhead**: Transferring large binary EPUB files across IPC can cause memory spikes and jank.
   - *Mitigation*: Stream directly to disk in Rust; frontend only references book IDs or localized asset URLs.
