# AI Agent Development Rules

## Project
This is a lightweight Android DRM-free ebook reader.

### Technology Stack
- Tauri 2
- Android
- TypeScript
- Rust
- foliate-js
- SQLite
- OPDS 1.2
- OPDS Progression 1.0

### Formats
- Primary MVP format: EPUB (EPUB 2 & EPUB 3)
- Optional later formats: PDF, CBZ, MOBI, AZW3, FB2
- The MVP is strictly DRM-free.

---

## Core Product Rules
1. Books must be downloaded completely before they can be opened for reading.
2. The reader must work offline after a successful download.
3. Do not implement DRM.
4. Do not implement ebook streaming.

---

## Architecture Rules
Keep these concerns strictly separated:
1. OPDS
2. Downloads
3. Local library
4. Reader
5. Reading progress
6. Progression synchronization
7. UI

### Boundaries
- The UI must not directly implement protocol logic.
- The reader must not directly implement OPDS logic.
- The reader must not directly write to SQLite.
- The OPDS client must not depend on UI components.
- The Rust layer owns native filesystem and download operations where appropriate.

---

## foliate-js
- Treat foliate-js as an external rendering engine.
- Do not fork or substantially modify it unless absolutely necessary.
- Pin the version / submodule commit.
- Wrap foliate-js behind an application-owned `Reader` interface.
- Do not expose foliate-js APIs throughout the application.
- If foliate-js changes, only the adapter should normally require modification.

---

## Security Rules
- Downloaded books and remote OPDS feeds are untrusted input.
- Never expose privileged Tauri APIs to ebook content.
- Never allow ebook content to access:
  - filesystem APIs
  - database APIs
  - Tauri commands
  - application secrets
  - OPDS credentials
- Ebook JavaScript execution must remain disabled.
- Use a restrictive Content Security Policy (CSP).
- Do not weaken security merely to make an EPUB work.

---

## Filesystem
- Store downloaded books in application-controlled storage (`$appData/books/<generated-book-id>/book.epub`).
- Never construct filesystem paths directly from untrusted book titles or author names.
- Use generated IDs for storage paths.
- Prevent path traversal: reject `../`, absolute path injection, arbitrary filesystem access, and symlink escapes.
- Use atomic downloads: `book.epub.part` -> successful validation -> `book.epub`.
- Never expose incomplete or corrupted downloads to the reader.

---

## Database
- SQLite is the source of truth for application metadata.
- Do not store important state only in frontend memory.
- Database migrations must be versioned.
- Never delete or modify existing migrations after they have been committed.

---

## Network & Offline Behavior
- All network operations must have:
  - timeouts
  - cancellation where practical
  - user-friendly error handling
  - retries where appropriate
  - offline handling
- The reader must never block on network availability.
- Reading progress is saved locally before synchronization.

---

## OPDS 1.2
- Support OPDS 1.2 initially. Do not add OPDS 2 unless explicitly requested.
- Support:
  - navigation feeds
  - acquisition feeds
  - metadata (title, author, publisher, etc.)
  - covers
  - pagination
  - MIME types
  - acquisition / download links
  - authentication abstraction (Basic / Bearer)
- Do not assume every OPDS server is perfectly spec-compliant; use fixtures and compatibility tests.

---

## Progression
- Implement OPDS Progression 1.0 as a synchronization layer.
- Never make page navigation depend on a network request.
- Local progress is authoritative for immediate UI behavior.
- Synchronize asynchronously.
- Handle offline synchronization queue and conflict resolution gracefully.

---

## Reader Abstraction
The application owns this core abstraction:

```typescript
interface Reader {
  open(bookPath: string): Promise<void>;
  close(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  goTo(locator: string): Promise<void>;
  getPosition(): Promise<ReadingPosition>;
  setPosition(position: ReadingPosition): Promise<void>;
  setTheme(theme: ReaderTheme): Promise<void>;
  setFontSize(size: number): Promise<void>;
  search?(query: string): Promise<SearchResult[]>;
  destroy(): void;
}
```

Do not leak foliate-js implementation details outside the adapter.

---

## Testing Standards
Every feature must have tests:
- Unit tests
- Integration tests where applicable
- Android/platform tests where platform behavior matters

Test negative and edge cases:
- Empty states
- Malformed input
- Network failure
- Offline mode
- Cancellation
- App restart
- Android background / foreground transitions
- Corrupted downloads
- Malformed EPUBs

---

## Dependencies
Do not add dependencies casually. Before adding a dependency:
1. Check whether existing code already solves the problem.
2. Check maintenance status.
3. Check license.
4. Check Android compatibility.
5. Document why it is necessary.

---

## Scope Control
Do not implement features outside the current milestone. Do not add:
- DRM
- User accounts / cloud storage
- Social features
- Annotations synchronization
- Audiobooks
- OPDS 2
- Ebook streaming
unless explicitly requested.

---

## Completion Rule
Never report a milestone or feature as "Done" unless:
1. Implementation is complete.
2. Unit and integration tests pass.
3. TypeScript type checking passes (`pnpm run build` / `tsc --noEmit`).
4. ESLint passes.
5. Rust cargo checks and clippy pass.
6. Android build passes when applicable.
7. Acceptance criteria pass.
8. Documentation (`STATUS.md`, `docs/`) is updated.

---

## Agent Workflow
Before starting any task:
1. Read `AGENTS.md` and `STATUS.md`.
2. Read relevant architecture documentation in `docs/`.
3. Inspect existing implementation.
4. Identify tests and acceptance criteria.
5. Implement the smallest correct change.
6. Run tests.
7. Run static checks (TypeScript, ESLint, Rust clippy).
8. Review git diff.
9. Update documentation if behavior changed.
10. Update `STATUS.md` and report what remains.
