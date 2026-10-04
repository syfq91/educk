# Testing Strategy & Quality Assurance — educk

## Overview
Quality in `educk` is validated across multiple layers. A feature or milestone is not considered complete merely because the happy path functions. Defensive edge-case testing is mandatory.

---

## Testing Tiers

### 1. Frontend Unit Tests (Vitest)
- **Scope**:
  - Domain models and validation logic.
  - OPDS Atom feed parser with fixture files (`fixtures/opds/`).
  - Progression conflict resolution algorithm.
  - State stores and repository mocks.
- **Execution**: `pnpm test`

### 2. Backend Unit & Integration Tests (Rust)
- **Scope**:
  - Download streaming, resume logic, and atomic file replacement.
  - Path traversal defense & UUID validation.
  - SQLite database migrations and schema integrity.
- **Execution**: `cargo test --manifest-path src-tauri/Cargo.toml`

### 3. Integration Fixture Tests
- **Fixtures Directory (`fixtures/`)**:
  - `fixtures/opds/navigation_valid.xml`
  - `fixtures/opds/acquisition_valid.xml`
  - `fixtures/opds/pagination_feed.xml`
  - `fixtures/opds/malformed_feed.xml`
  - `fixtures/opds/xxe_attack_vector.xml`
  - `fixtures/books/valid_epub2.epub`
  - `fixtures/books/valid_epub3.epub`
  - `fixtures/books/corrupted.epub`
  - `fixtures/books/script_injection.epub`
- **Fake Progression Server**:
  - Mock HTTP server simulating 200, 401, 404, 500 responses and conflict payloads for deterministic testing.

### 4. Platform & Android Lifecycle Tests
- **Android Target**:
  - Verify compilation: `pnpm tauri android build --apk` (or cargo mobile check).
  - Test app backgrounding (`onPause`) and foregrounding (`onResume`).
  - Verify reading position survives process termination and device rotation.
  - Verify atomic download recovery after unexpected termination.

---

## Negative & Edge Case Verification Matrix

| Category | Test Scenario | Expected Outcome |
| :--- | :--- | :--- |
| **OPDS** | Malformed / non-Atom XML | Controlled error message, no app crash |
| **OPDS** | Entity expansion / XXE attempt | Entity ignored or parsing aborted cleanly |
| **OPDS** | Relative links without base | Resolved against feed root safely |
| **OPDS** | 401 Unauthorized | Prompts for credentials; no raw error dump |
| **Download** | Aborted mid-download | `.part` file cleaned up; library unaffected |
| **Download** | Corrupted EPUB headers | Validation fails; file deleted; error logged |
| **Download** | Disk full / quota error | User notified; atomic roll-back |
| **Reader** | Ebook with `<script>` tag | Script fails to execute; sandbox prevents access |
| **Reader** | Reader opened while offline | Opens instantly from disk; zero network calls |
| **Reader** | Malformed internal EPUB spine | Graceful error screen; option to return to library |
| **Progress** | Device offline during sync | Saved locally; queued in `sync_state` |
| **Progress** | Remote position is newer | Prompts user or syncs forward without losing history |
