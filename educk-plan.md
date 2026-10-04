# educk — Autonomous AI Coding Agent Execution Plan

> **Operational blueprint and repository constitution** for autonomous coding agents (Claude Code, Gemini / Antigravity, Codex, etc.) building **educk**: a lightweight, privacy-preserving, offline-reliable Android DRM-free ebook reader using Tauri 2, TypeScript, Rust, foliate-js, SQLite, OPDS 1.2, and OPDS Progression 1.0.

---

## Strategic Context & Ecosystem Findings

For autonomous coding agents, an execution plan must be strictly operational: provide the agent with a repository-level constitution, a fixed implementation sequence, explicit acceptance tests, and instructions to work autonomously until each milestone is genuinely complete.

### Key Ecosystem Constraints
- **foliate-js Stability**: Upstream maintainers explicitly describe `foliate-js` as unstable with evolving APIs. They recommend **vendoring or submoduling** it rather than consuming it as a floating npm dependency. Upstream already provides the `<foliate-view>` web component entry point and built-in OPDS 1.x parsing utilities.
- **Tauri 2 Filesystem Model**: Tauri 2's filesystem model aligns with Android requirements because filesystem access is application-scoped by default (`$appData`), and permissions / capabilities are explicitly declared and verified.

---

## 1. Agent Mission Specification

Do not give the agent a vague prompt such as:
> *"Build me an ebook reader."*

Give it a repository-level mission:

> **Mission**: Build a production-quality Android DRM-free ebook reader using Tauri 2, TypeScript, Rust, foliate-js, SQLite, OPDS 1.2, and OPDS Progression 1.0.
>
> - **Download-First**: Books must be downloaded completely before reading. The reader must work offline after download.
> - **Format**: EPUB (EPUB 2 & EPUB 3) is the primary MVP format.
> - **DRM-Free**: Do not implement DRM or ebook streaming.
> - **Threat Model**: Treat all downloaded ebook content and remote OPDS feeds as untrusted input.
> - **Milestone-by-Milestone**: Work sequentially. Do not move to the next milestone until the current milestone's acceptance tests pass.
> - **Pragmatism**: Prefer simple architecture and existing libraries over custom abstractions.
> - **Verification**: Never claim a feature is complete merely because the happy path works.

---

## 2. Target Repository Structure

The agent should create and maintain this clean directory layout:

```text
educk/
├── AGENTS.md                  # Repository engineering rules & boundaries
├── CLAUDE.md                  # Operational guide for autonomous agents
├── README.md                  # Project overview & documentation index
├── LICENSE                    # Open-source license (MIT)
├── package.json               # Frontend dependencies & scripts
├── pnpm-lock.yaml             # Pinned package lockfile
├── tsconfig.json              # Strict TypeScript configuration
├── eslint.config.js           # ESLint flat configuration
│
├── docs/                      # Architectural & design specifications
│   ├── product.md             # Product requirements & user stories
│   ├── architecture.md        # 7-layer architecture & component contracts
│   ├── security.md            # Threat model, sandbox, & CSP specifications
│   ├── data-model.md          # SQLite schema & migration guidelines
│   ├── opds.md                # OPDS 1.2 feed parsing & acquisition specs
│   ├── progression.md         # OPDS Progression 1.0 sync & conflict resolution
│   ├── reader.md              # Reader abstraction & foliate-js integration
│   ├── testing.md             # Testing strategy, fixtures, & Android lifecycle
│   ├── tasks.yaml             # Machine-readable task & milestone tracker
│   ├── decisions/             # Architecture Decision Records (ADRs)
│   └── research/              # Technology spike reports & ecosystem notes
│
├── fixtures/                  # Test fixtures & mocks
│   ├── opds/                  # Sample Atom XML feeds & navigation mocks
│   └── books/                 # Valid, malformed, and adversarial EPUB fixtures
│
├── src/                       # Frontend application (TypeScript)
│   ├── app/                   # Shell components, navigation, routing
│   ├── components/            # Reusable UI widgets (buttons, modals, lists)
│   ├── features/              # Feature modules
│   │   ├── sources/           # OPDS catalog management
│   │   ├── catalog/           # OPDS feed browsing
│   │   ├── books/             # Book metadata views
│   │   ├── downloads/         # Download status & queue UI
│   │   ├── library/           # Local bookshelf & book management
│   │   ├── reader/            # Ebook reader UI & viewer controls
│   │   ├── progression/       # Reading progress sync indicators
│   │   └── settings/          # Reader styling & application settings
│   ├── domain/                # Pure domain models & interfaces
│   ├── services/              # Business logic & adapter implementations
│   └── styles/                # Global CSS & theme tokens
│
├── src-tauri/                 # Backend native application (Rust)
│   ├── src/
│   │   ├── commands/          # Tauri IPC command handlers
│   │   ├── database/          # SQLite connection & query layer
│   │   ├── downloads/         # Native HTTP download engine (reqwest)
│   │   ├── filesystem/        # Scoped path resolution & atomic file writes
│   │   └── lib.rs             # Tauri application entry & plugin setup
│   ├── capabilities/          # Tauri 2 permission sets & security scopes
│   └── migrations/            # Versioned SQL migration scripts
│
├── vendor/                    # Pinned third-party submodules
│   └── foliate-js/            # Pinned checkout of foliate-js rendering engine
│
└── tests/                     # Automated test suites
    ├── unit/                  # Vitest frontend unit tests & Cargo Rust tests
    ├── integration/           # Cross-component & IPC mock integration tests
    └── e2e/                   # Fake OPDS server & golden path workflows
```

> [!IMPORTANT]
> **Vendor foliate-js as a pinned git submodule or checkout** under `vendor/foliate-js` rather than installing a floating package from npm, because upstream explicitly notes that its internal APIs are evolving.

---

## 3. Core Constitution (`AGENTS.md`)

`AGENTS.md` is the central engineering constitution of the repository. Autonomous agents must inspect and obey these rules before modifying any code.

```markdown
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
```

---

## 4. Agent Operational Guide (`CLAUDE.md`)

While `AGENTS.md` codifies engineering rules, `CLAUDE.md` instructs the agent on **how to operate autonomously** within the repository.

```markdown
# Project Instructions

You are the primary software engineering agent for this repository.
Your job is to build the application incrementally and leave the repository in a better, working state after every task.

## Autonomous Behavior
- You may inspect files, run commands, create files, modify code, run tests, and diagnose failures without asking for permission.
- Do not ask the user for confirmation for normal engineering decisions.
- Ask the user only when:
  - A product decision cannot reasonably be inferred.
  - External credentials are required.
  - An irreversible external action is required.
  - Two architectural choices have materially different product consequences.
- Otherwise, choose the simplest reasonable implementation and document the decision.

## Before Coding
Always:
1. Read `AGENTS.md` and `STATUS.md`.
2. Read `docs/architecture.md` and relevant technical specs.
3. Inspect existing implementation and tests.
4. Search for existing abstractions before creating new ones.

## Work in Milestones
- The project is developed milestone-by-milestone.
- Never implement the entire application in a single pass.
- Complete one milestone, verify all acceptance criteria, and update documentation before continuing.

## Verification Checklist
After every implementation:
- Run relevant unit tests (`pnpm test`).
- Run TypeScript typecheck (`pnpm run typecheck`).
- Run ESLint (`pnpm run lint`).
- Run Rust cargo check (`cargo check --manifest-path src-tauri/Cargo.toml`).
- Run Rust clippy (`cargo clippy --manifest-path src-tauri/Cargo.toml`).
- Build Android target when milestone touches native or WebView behavior.
- Report environment failures accurately, distinguishing them from application defects.

## Git Discipline
- Make focused, atomic commits.
- Commit convention:
  - `feat(scope): description`
  - `fix(scope): description`
  - `test(scope): description`
  - `refactor(scope): description`
  - `docs(scope): description`
  - `chore(scope): description`
- Before committing:
  - Inspect `git diff` and `git status`.
  - Ensure no credentials, temporary files, or build artifacts are committed.

## Architecture Discipline
- Do not introduce new architectural layers unless strictly necessary.
- Hierarchy preference:
  `existing abstraction` > `small extension` > `new abstraction`
- Keep the application modular but avoid premature abstraction.

## Agent Handoff Report
At the end of every task, report:
1. Completed work
2. Files changed
3. Tests run and verification results
4. Known limitations or blockers
5. Recommended next task
```

---

## 5. Phased Implementation Roadmap

Execute the implementation **one milestone at a time**. The agent must not advance to subsequent phases until the current phase's acceptance criteria are fully verified.

```
M0: Reconnaissance ──► M1: Bootstrap ──► M2: Foliate Spike ──► M3: Reader Core
                                                                    │
M6: Local Library ◄── M5: Download Engine ◄── M4: SQLite Layer ◄────┘
      │
      └──► M7: OPDS 1.2 ──► M8: OPDS UI ──► M9: OPDS Integration
                                                    │
M12: Reader UX ◄── M11: OPDS Progression ◄── M10: Reading Progress ◄┘
      │
      └──► M13: Android Lifecycle ──► M14: Security Audit ──► M15: Compatibility
                                                                   │
Release v1.0 ◄── M17: E2E Golden Path ◄── M16: Performance ◄───────┘
```

---

### Phase 0 — Reconnaissance & Architectural Specifications

> **Agent Prompt:**
> You are starting a new project. Do not implement the application yet.
> Inspect the repository and research the current documentation for:
> - Tauri 2 Android capabilities (scoped storage, HTTP, IPC)
> - foliate-js architecture and `<foliate-view>` web component
> - OPDS 1.2 Atom XML feed specifications
> - OPDS Progression 1.0 synchronization specification
> - SQLite on Android via Tauri
>
> Create:
> - `docs/research/tauri.md`
> - `docs/research/foliate.md`
> - `docs/research/opds.md`
> - `docs/research/progression.md`
> - `docs/product.md`
> - `docs/architecture.md`
> - `docs/security.md`
> - `docs/data-model.md`
> - `docs/testing.md`
>
> Identify technical risks, record initial ADRs, and provide an architecture recommendation. Stop when complete.

---

### Phase 1 — Project Bootstrap & Verification

> **Agent Prompt:**
> Implement Milestone 1: project bootstrap and mobile shell baseline.
>
> Requirements:
> - Tauri 2 Android target initialization (`src-tauri/gen/android`)
> - TypeScript frontend with strict typing (`tsconfig.json`)
> - Rust backend setup with Tauri commands (`src-tauri/`)
> - ESLint flat config (`eslint.config.js`)
> - Vitest unit test runner (`vitest`)
> - Minimal mobile application shell:
>   - Home screen with empty state
>   - Navigation placeholder (Library, Catalogs, Settings)
>   - Application version query via Tauri command (`get_app_version`)
>
> Acceptance Criteria:
> 1. Frontend starts in dev mode (`pnpm run dev`).
> 2. Tauri starts on desktop.
> 3. Android debug APK builds successfully (`tauri android build --apk`).
> 4. TypeScript check passes (`pnpm run typecheck`).
> 5. ESLint passes with zero warnings (`pnpm run lint`).
> 6. Rust check and clippy pass (`cargo check`, `cargo clippy`).

---

### Phase 2 — foliate-js Android Proof of Concept (Spike)

> **Agent Prompt:**
> Implement Milestone 2: foliate-js Android proof-of-concept spike.
>
> **Goal**: Prove that `foliate-js` can reliably render a locally stored EPUB inside the Tauri Android WebView under strict security boundaries.
>
> Tasks:
> 1. Pin `foliate-js` to a known commit and vendor under `vendor/foliate-js` or submodule.
> 2. Do not modify upstream code unless strictly necessary.
> 3. Create a minimal `ReaderAdapter` proof of concept.
> 4. Load a local EPUB fixture from app storage.
> 5. Render the book using `<foliate-view>`.
> 6. Implement forward and backward navigation.
> 7. Listen to relocation events and extract stable CFI locators.
> 8. Restore the reading position from a saved CFI locator.
> 9. Apply strict CSP: `script-src 'none'; object-src 'none'`.
> 10. Explicitly verify that ebook JavaScript cannot access Tauri IPC or browser APIs.
>
> Document results and findings in `docs/reader.md` and ADR 001. Stop and diagnose if local file loading fails in the Android WebView.

---

### Phase 3 — Production Reader Core Abstraction

> **Agent Prompt:**
> Implement Milestone 3: production Reader abstraction.
>
> Create:
> - `src/domain/reader.ts`
> - `src/services/reader/` (implementing `foliate-adapter.ts`)
>
> Architectural Boundary:
> - The application must not directly depend on `foliate-js` outside the adapter.
> - Expose the clean `Reader` interface (`open`, `close`, `next`, `previous`, `goTo`, `getPosition`, `setPosition`, `setTheme`, `setFontSize`, `destroy`).
> - Support both EPUB 2 and EPUB 3 formats.
>
> Reader UI:
> - Page turn navigation (touch & keyboard)
> - Progress percentage display
> - Font size adjustments
> - Light, Dark, and Sepia themes
> - Table of Contents (TOC) navigation
>
> Acceptance Criteria:
> 1. Ebook opens cleanly from local storage without network access.
> 2. Page navigation updates reading position.
> 3. Closing and reopening restores exact CFI reading location.
> 4. Malformed EPUBs trigger controlled domain errors.
> 5. Sandboxed scripts inside EPUBs remain completely inert.

---

### Phase 4 — Persistent Data Layer (SQLite)

> **Agent Prompt:**
> Implement Milestone 4: persistent data layer using SQLite.
>
> Requirements:
> - Create immutable, versioned SQL migrations under `src-tauri/migrations/`.
> - Implement typed domain models and data repositories.
> - No raw SQL queries inside UI components.
>
> Core Schema:

```sql
-- Sources / Catalogs
CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    username TEXT,
    auth_type TEXT CHECK (auth_type IN ('none', 'basic', 'bearer')),
    auth_data TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Downloaded Books
CREATE TABLE books (
    id TEXT PRIMARY KEY,
    source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
    remote_id TEXT,
    title TEXT NOT NULL,
    subtitle TEXT,
    authors TEXT,
    cover_url TEXT,
    acquisition_url TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    local_path TEXT NOT NULL UNIQUE,
    file_size INTEGER NOT NULL,
    downloaded_at INTEGER NOT NULL
);

-- Reading Progress
CREATE TABLE reading_progress (
    book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    progression REAL NOT NULL DEFAULT 0.0,
    locator TEXT NOT NULL,
    href TEXT,
    title TEXT,
    modified_at INTEGER NOT NULL,
    synced_at INTEGER
);

-- Synchronization State
CREATE TABLE sync_state (
    book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    local_version INTEGER NOT NULL DEFAULT 1,
    remote_version INTEGER NOT NULL DEFAULT 0,
    last_sync_at INTEGER,
    sync_status TEXT CHECK (sync_status IN ('idle', 'pending', 'syncing', 'error')) DEFAULT 'idle'
);
```

> Acceptance Criteria:
> - Unit tests verify CRUD operations across all tables.
> - Migrations execute cleanly on fresh database and upgrade paths.
> - Data survives application restart.

---

### Phase 5 — Native Download Engine

> **Agent Prompt:**
> Implement Milestone 5: native download engine in Rust.
>
> Requirements:
> - Complete book downloads before exposing them to the reader.
> - Stream download chunks directly to disk to minimize memory footprint.
> - Download to temporary file: `book.epub.part` -> validate archive integrity -> atomic rename to `book.epub`.
> - Progress tracking (bytes downloaded, total bytes, percentage).
> - Cancellation and timeout support.
> - Automatic retries with exponential backoff on transient network drops.
> - Duplicate download prevention.
> - Storage isolation: `$appData/books/<generated-book-id>/book.epub`. Reject arbitrary filenames.
>
> Validation Flow:
```text
[Remote OPDS Acquisition URL]
             │
             ▼
[Download to: book.epub.part]
             │
             ▼
[Validate ZIP structure & mimetype] ──(Invalid)──► [Delete temp file & return error]
             │
          (Valid)
             ▼
[Atomic rename: book.epub]
             │
             ▼
[Register in SQLite books table]
```

---

### Phase 6 — Local Library

> **Agent Prompt:**
> Implement Milestone 6: local library bookshelf.
>
> Features:
> - Display downloaded books with cover, title, author, and reading progress.
> - Sort by recently read, title, and download date.
> - Open book in Reader adapter.
> - Delete download and cleanup associated filesystem assets and SQLite records.
> - Empty state illustration when no books are downloaded.
> - Corrupted / missing file warning indicators.
>
> Acceptance Criteria:
> 1. Install app -> download book -> disable network -> kill app -> restart.
> 2. Library displays book offline.
> 3. Book opens instantly into reader.
> 4. Reading position restores perfectly.

---

### Phase 7 — OPDS 1.2 Client

> **Agent Prompt:**
> Implement Milestone 7: application-owned OPDS 1.2 catalog client.
>
> Requirements:
> - Parse Atom XML feeds without leaking raw XML processing into UI components.
> - Support Navigation Feeds and Acquisition Feeds.
> - Extract Dublin Core metadata (`dc:title`, `dc:creator`, `dc:identifier`, `dc:publisher`).
> - Parse thumbnail and full cover links (`rel="http://opds-spec.org/image"` and `rel="http://opds-spec.org/image/thumbnail"`).
> - Handle acquisition links (`rel="http://opds-spec.org/acquisition"`) with MIME type filtering (`application/epub+zip`).
> - Handle feed pagination (`rel="next"`).
> - Resolve relative URLs against feed base URL.
> - Abstract authentication (HTTP Basic and Bearer tokens).
>
> Test Fixture Suite:
> - `fixtures/opds/navigation-feed.xml`
> - `fixtures/opds/acquisition-feed.xml`
> - `fixtures/opds/paginated-feed.xml`
> - `fixtures/opds/malformed-feed.xml`
> - `fixtures/opds/relative-urls-feed.xml`
> - `fixtures/opds/auth-required-response.xml`
>
> Acceptance Criteria:
> - Unit tests pass completely against local test fixtures without requiring live internet access.

---

### Phase 8 — OPDS Browsing UI

> **Agent Prompt:**
> Implement Milestone 8: OPDS catalog browsing interface.
>
> Navigation Flow:
```text
[Catalogs List] ──► [Add Catalog] (Name, URL, Credentials)
       │
       ▼
[Catalog Root Feed]
       │
       ├──► [Navigation Feed / Categories] ──► [Sub-Category]
       │                                              │
       └──► [Acquisition Feed / Books List] ◄─────────┘
                   │
                   ▼
           [Book Detail View]
                   │
                   ▼
           [Download EPUB Action]
```
>
> Edge Case States:
> - Loading skeletons
> - Network connection failure with retry button
> - HTTP 401/403 authentication prompt
> - Empty feed notices
> - Infinite scroll / pagination loading controls

---

### Phase 9 — OPDS & Download Engine Integration

> **Agent Prompt:**
> Implement Milestone 9: end-to-end catalog acquisition pipeline.
>
> Wire together:
```text
[OPDS Book Entry] ──► [Book Detail Screen]
                             │
                             ▼
                    [Trigger Download]
                             │
                             ▼
                 [Rust DownloadEngine IPC]
                             │
                  ┌──────────┴──────────┐
                  ▼                     ▼
          [Download Stream]     [Progress Events]
                  │                     │
                  ▼                     ▼
         [Atomic File Commit]   [UI Progress Bar]
                  │
                  ▼
         [SQLite Book Insert]
                  │
                  ▼
         [Local Library Entry]
                  │
                  ▼
         [Open in Reader]
```
>
> Acceptance Test:
> - Add catalog -> browse -> select EPUB -> trigger download -> verify progress bar -> verify book appears in library -> open reader -> verify book renders offline.

---

### Phase 10 — Local Reading Progress

> **Agent Prompt:**
> Implement Milestone 10: robust local reading progress tracking.
>
> Flow:
```text
[Reader Relocation Event]
            │
            ▼
   [ReadingPosition] (locator CFI, progression %, href, chapter title)
            │
            ▼
[Debounce Controller (1000ms)]
            │
            ▼
[ProgressRepository (SQLite)]
```
>
> Requirements:
> - Debounce rapid page turns to avoid disk thrashing.
> - Flush immediately on:
>   - Reader close / unmount
>   - App background / pause event
>   - Navigation back to library
> - Zero network dependencies — reading must never stutter or wait for network I/O.
> - Handle missing or corrupted locators gracefully.

---

### Phase 11 — OPDS Progression 1.0 Synchronization

> **Agent Prompt:**
> Implement Milestone 11: OPDS Progression 1.0 synchronization client.
>
> Requirements:
> - Implement `ProgressionClient` supporting:
>   - `GET` remote progression endpoint
>   - `PUT` local progression update
> - Manage client device identifier (`X-Device-Id`).
> - Maintain local synchronization queue for offline operations.
> - Asynchronous background sync:
>   - On app startup / resume
>   - On opening a book
>   - On closing a book
> - Reading must **never block** on progression synchronization.
>
> Integration Test Suite Matrix:
> 1. No server progress exists -> push local progress.
> 2. Server progress exists -> compare and resolve.
> 3. Local progress newer -> push to server.
> 4. Server progress newer -> prompt or update local state.
> 5. Offline mode -> queue updates locally.
> 6. Network restored -> flush queued updates.
> 7. Failed `PUT` (HTTP 500) -> retry with exponential backoff.
> 8. Application killed during synchronization -> recovery on restart.

---

## 6. Progress Synchronization & Conflict Resolution Strategy

Do not implement complex CRDTs (Conflict-free Replicated Data Types) for ebook progress. Ebook reading is an inherently linear, single-user activity.

### Resolution Algorithm
1. **Source of Truth**: Local reading progress is always authoritative for the active reader session.
2. **Comparison Matrix**:
   - Compare `modified_at` ISO timestamps between local and remote records.
   - If `remote.modified_at > local.modified_at` and `remote.progression != local.progression`:
     - If local progress has changed during the current session, prompt the user:
       > *"You were further ahead on another device (72% vs 45%). Jump to latest position?"*
     - If opening a book cold, apply the remote position.
   - If `local.modified_at >= remote.modified_at`:
     - Retain local position and queue remote `PUT`.
3. **Pluggable Architecture**: Keep `ProgressionClient` decoupled from SQLite storage so synchronization strategies can be refined without rewriting reading logic.

---

## 7. Phase 12 — Reader UX & Controls

> **Agent Prompt:**
> Implement Milestone 12: polished reader experience and ergonomics.
>
> Scope Controls:
> Implement **only** the reader controls defined in `docs/product.md`. Do not implement annotations, bookmarks sync, or audio playback.

```text
Reader UX
├── Touch Gestures
│   ├── Tap center: toggle UI bars (header/footer)
│   ├── Tap left / swipe right: previous page
│   └── Tap right / swipe left: next page
│
├── Visual Layout
│   ├── Reading progress slider (% and page numbers)
│   ├── Chapter title header
│   └── Battery & system time display
│
├── Typography Controls
│   ├── Font size (slider, 12pt – 36pt)
│   ├── Font family (Serif, Sans-Serif, OpenDyslexic)
│   ├── Line spacing (1.2, 1.5, 1.8)
│   └── Margins (narrow, normal, wide)
│
└── Color Themes
    ├── Light (pure white / gray text)
    ├── Sepia (warm paper tone)
    └── Dark / AMOLED (true black for battery saving)
```

---

## 8. Phase 13 — Android Lifecycle & Reliability

> **Agent Prompt:**
> Implement Milestone 13: Android lifecycle reliability and resilience testing.
>
> Validate application stability under harsh mobile OS events:
> - **App Backgrounding**: Progress flushes cleanly to SQLite.
> - **Process Termination**: System killing background process does not corrupt SQLite or downloads.
> - **Screen Rotation / Lock**: WebView preserves active viewport and CFI locator.
> - **Low Memory Killer (LMK)**: App handles memory pressure without data loss.
> - **Network Flapping**: Downloads pause and resume automatically when switching between Wi-Fi and Cellular.
> - **Corrupted File Recovery**: Deleting or corrupting an underlying EPUB produces a user-friendly recovery prompt instead of crashing.

---

## 9. Phase 14 — Adversarial Security Audit

> **Agent Prompt:**
> Conduct an adversarial security audit assuming malicious OPDS catalogs and hostile EPUB files.
>
> Test and Mitigate Against:
> 1. **Path Traversal**: Reject filenames containing `../`, `/`, null bytes, or Windows drive syntax.
> 2. **ZIP Bomb Attacks**: Enforce maximum uncompressed size limits and compression ratio thresholds during EPUB inspection.
> 3. **XML Entity Attacks (XXE)**: Disable external entity resolution, DTD processing, and external parameter entities in Atom XML and EPUB container parsers.
> 4. **Ebook JavaScript Execution**: Enforce WebView sandbox parameters and CSP:
>    ```http
>    Content-Security-Policy: default-src 'none'; img-src blob: data: 'self'; style-src 'unsafe-inline'; script-src 'none'; frame-src 'none';
>    ```
> 5. **IPC & Capability Leakage**: Ensure the iframe/WebView rendering ebook content has zero access to the `__TAURI__` IPC bridge, filesystem APIs, or network requests.
> 6. **Credential Protection**: Ensure OPDS HTTP Basic/Bearer tokens are stored securely in SQLite and never logged or exposed to book content.
>
> For every identified vulnerability: reproduce -> determine severity -> fix -> add automated regression test -> document in `docs/security.md`.

---

## 10. Phase 15 — Real-World Server Compatibility

Test the OPDS 1.2 client against real-world open-source server implementations:
- **Calibre-Web**
- **Komga**
- **Kavita**
- **Readarr**

### Compatibility Layer Architecture
```text
[Raw OPDS 1.2 Feed]
        │
        ▼
[Standard Atom XML Parser] ──(Valid standard)──► [Core Domain Model]
        │
    (Deviation)
        ▼
[Compatibility Layer (Heuristics)]
        ├── Non-standard MIME types (e.g. x-epub)
        ├── Relative URL edge cases in links
        └── Non-standard author/title XML tags
        │
        ▼
[Normalized Domain Model]
```

> [!WARNING]
> Do not pollute the core OPDS parser with server-specific workarounds. All server quirks must be isolated inside the compatibility normalization layer.

---

## 11. Phase 16 — Performance Engineering & Resource Targets

Enforce these strict performance budgets on mobile hardware:

| Metric | Target Budget | Verification Method |
| :--- | :--- | :--- |
| **Cold Startup Time** | `< 2.0 seconds` to interactive library | Android Profiler / logcat |
| **Library Scrolling** | Sustained `60 fps` with 500+ books | Virtualized list rendering |
| **Page Turn Latency** | `< 100 ms` perceived latency | WebView frame performance |
| **Download Memory Overhead** | Direct streaming to disk (`< 20 MB` RAM) | Native Rust memory profile |
| **EPUB Parsing Memory** | Lazy load spine elements; never load 100MB+ EPUB entirely into memory | Heap allocation monitoring |

---

## 12. Phase 17 — End-to-End Golden Path Tests

Implement an automated fake OPDS server (`tests/e2e/opds-server/`) and execute the **Golden Path**:

```text
1. Fresh App Install
        │
        ▼
2. Add Fake OPDS Catalog Endpoint
        │
        ▼
3. Browse Navigation & Acquisition Feeds
        │
        ▼
4. Download Test EPUB (Atomic verify & commit)
        │
        ▼
5. Open Book in Reader
        │
        ▼
6. Navigate to Chapter 3 (CFI captured)
        │
        ▼
7. Background App / Kill Process
        │
        ▼
8. Reopen App (Verify offline library)
        │
        ▼
9. Reopen Book (Verify CFI restoration to Chapter 3)
        │
        ▼
10. Restore Network & Verify Progression Synchronization
```

---

## 13. Machine-Readable Task Tracking (`docs/tasks.yaml`)

Autonomous agents must read and update `docs/tasks.yaml` to maintain state across execution sessions:

```yaml
version: "1.0"
project: "educk"

milestones:
  - id: M0
    name: "Reconnaissance & Architecture"
    status: complete
  - id: M1
    name: "Project Bootstrap"
    status: complete
  - id: M2
    name: "foliate-js Android Spike"
    status: in_progress
  - id: M3
    name: "Reader Core Abstraction"
    status: pending
  - id: M4
    name: "Persistent Data Layer"
    status: pending
  - id: M5
    name: "Download Engine"
    status: pending
  - id: M6
    name: "Local Library"
    status: pending
  - id: M7
    name: "OPDS 1.2 Client"
    status: pending
  - id: M8
    name: "OPDS UI"
    status: pending
  - id: M9
    name: "OPDS & Download Integration"
    status: pending
  - id: M10
    name: "Local Reading Progress"
    status: pending
  - id: M11
    name: "OPDS Progression 1.0"
    status: pending
  - id: M12
    name: "Reader UX"
    status: pending
  - id: M13
    name: "Android Lifecycle"
    status: pending
  - id: M14
    name: "Security Audit"
    status: pending
  - id: M15
    name: "Server Compatibility"
    status: pending
  - id: M16
    name: "Performance"
    status: pending
  - id: M17
    name: "E2E Golden Path"
    status: pending

tasks:
  - id: RDR-001
    milestone: M2
    title: "Pin and vendor foliate-js"
    status: in_progress
    owner: "reader"
    tests:
      - "tests/unit/reader-vendor.test.ts"
```

---

## 14. Real-Time Status Tracking (`STATUS.md`)

Maintain `STATUS.md` at the repository root to document live progress:

```markdown
# Current Status

**Current Milestone**: M2 — foliate-js Android Proof of Concept (In Progress)

---

## Completed
- **Governance & Setup**:
  - `AGENTS.md`: Core engineering rules, architectural boundaries, and security rules
  - `CLAUDE.md`: Agent operational instructions and verification checklist
  - `docs/tasks.yaml`: Machine-readable roadmap
- **Milestone M0 (Reconnaissance & Research)**: Specs and ADRs recorded.
- **Milestone M1 (Bootstrap & Baseline Verification)**: Mobile shell and Android debug APK built.

---

## In Progress
- Milestone M2: Foliate-js Android proof-of-concept spike.

---

## Blocked
None.

---

## Known Issues
None.

---

## Next Task
- Pin foliate-js and implement minimal `ReaderAdapter` spike.

---

## Verification Summary
- TypeScript (`pnpm run typecheck`): PASS
- ESLint (`pnpm run lint`): PASS
- Unit Tests (`pnpm test`): PASS
- Rust Check (`cargo check`): PASS
- Rust Clippy (`cargo clippy`): PASS
- Android Build (`tauri android build --apk`): PASS
```

---

## 15. Multi-Agent Orchestration & Context Specialization

When running multi-agent workflows (e.g. Antigravity or team-based agent architectures), divide responsibilities by architectural domain.

```text
                            ┌──────────────┐
                            │  Lead Agent  │
                            │ (Architect)  │
                            └──────┬───────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
  ┌──────────────┐          ┌──────────────┐          ┌──────────────┐
  │ Reader Agent │          │  OPDS Agent  │          │ Native Agent │
  │ (foliate-js) │          │ (Atom XML)   │          │ (Rust/Tauri) │
  └──────┬───────┘          └──────┬───────┘          └──────┬───────┘
         │                         │                         │
         └─────────────────────────┼─────────────────────────┘
                                   │
                                   ▼
                            ┌──────────────┐
                            │   QA Agent   │
                            │ (Test Suites)│
                            └──────┬───────┘
                                   │
                                   ▼
                            ┌──────────────┐
                            │Security Agent│
                            │(Audit & CSP) │
                            └──────────────┘
```

### Team Governance Rules
1. **The Lead Agent owns the architecture**: Specialist subagents cannot change interfaces or database schemas without permission from the lead.
2. **Execute in Dependency Order**: Run tasks in parallel only after interface contracts are committed and verified.
3. **Dedicated Security & QA Verification**: A separate subagent inspects code changes specifically for vulnerabilities and edge cases.

---

## 16. Execution Patterns: Claude Code vs. Antigravity

### Pattern A: Claude Code (Single Iterative Agent)
- Provide `AGENTS.md`, `CLAUDE.md`, and `STATUS.md`.
- Issue concise operational directives:
  > *"Read AGENTS.md, STATUS.md, and docs/tasks.yaml. Implement the next incomplete task in Milestone M2. Run all tests and checks. If clean, update STATUS.md and prepare the next task. If blocked, document the blocker."*

### Pattern B: Antigravity / Multi-Agent Teams
- Assign agents to distinct workspaces or functional boundaries:
  - `Researcher`: Explores ecosystem libraries and writes ADRs.
  - `Native Specialist`: Implements Rust download engine, SQLite queries, and Tauri commands.
  - `Frontend / Reader Specialist`: Integrates foliate-js adapter and Reader UI.
  - `Protocol Specialist`: Implements OPDS 1.2 client and Progression 1.0 sync.
  - `QA & Adversarial Auditor`: Writes edge-case fixtures and exploits.

---

## 17. De-Risking Strategy: Test the Risky Thing First

Always prioritize the highest-risk technical assumptions before building secondary user interface components:

```text
[Highest Risk]
  1. Can foliate-js reliably render local EPUBs inside Tauri Android WebView?
         │
         ▼
  2. Can large EPUB files be streamed and served securely under strict CSP?
         │
         ▼
  3. Does reading position reliably survive Android lifecycle & process termination?
         │
         ▼
  4. Does the OPDS 1.2 client parse feeds from diverse, non-standard servers?
         │
         ▼
  5. Can Progression 1.0 synchronize progress asynchronously without race conditions?
         │
         ▼
  6. Polish Reader UI, animations, and typography controls.
[Lowest Risk]
```

---

## 18. Reference Implementations & External Prior Art

When researching practical integration techniques:
- Consult open-source readers built with **Tauri 2 + React/TypeScript + foliate-js** as practical references for Android WebView initialization and asset protocols.
- **Rules of Engagement**:
  - Use external repositories as structural references only.
  - Do not blindly copy architectures or third-party abstractions.
  - Always verify licenses before referencing code.
  - Prioritize official Tauri 2 and foliate-js upstream documentation.

---

## 19. Production Release Gate (v1.0 Checklist)

Before declaring version **1.0.0 Ready for Production**, every item in this release gate must pass:

### Android Reliability
- [ ] Clean install on Android device/emulator succeeds
- [ ] Application upgrade path preserves existing SQLite database
- [ ] App restart restores previous state seamlessly
- [ ] Background / foreground transitions retain open book and CFI position
- [ ] Screen lock / unlock retains reader state
- [ ] Storage full or read-only failure handled with user alert

### OPDS 1.2 Catalogs
- [ ] Add and remove OPDS catalogs
- [ ] Browse navigation feeds
- [ ] Browse acquisition feeds
- [ ] Pagination (`rel="next"`) loads subsequent entries smoothly
- [ ] HTTP Basic and Bearer authentication succeed
- [ ] Malformed XML feeds fail gracefully with helpful error messages
- [ ] Offline state clearly displayed when network is absent

### Download Engine
- [ ] Progress reporting reflects actual downloaded bytes
- [ ] User cancellation aborts active downloads and cleans up temporary files
- [ ] Transient network drops trigger retry with exponential backoff
- [ ] Interrupted downloads resume or restart cleanly
- [ ] Corrupted downloads are detected, purged, and reported
- [ ] Atomic file commit prevents partial EPUB exposure
- [ ] Duplicate download requests are deduplicated

### Ebook Reader
- [ ] EPUB 2 rendering works
- [ ] EPUB 3 rendering works
- [ ] Inline images and cover art render properly
- [ ] Ebook CSS styling applies without breaking reader layout
- [ ] Embedded fonts render properly
- [ ] Table of Contents (TOC) navigates accurately
- [ ] Forward / backward navigation works via tap zones and swipe gestures
- [ ] Reading position is saved and restored accurately
- [ ] Dark, Light, and Sepia color themes render cleanly
- [ ] Font size changes dynamically recalculate layout
- [ ] Malformed EPUB files produce controlled error screens

### Progression Synchronization
- [ ] Local reading progress persists offline
- [ ] `GET` remote progression endpoint retrieves remote state
- [ ] `PUT` local progression endpoint updates remote server
- [ ] Offline progress updates are queued and flushed upon reconnect
- [ ] Retries on network drop or HTTP 500 responses
- [ ] Conflict resolution algorithm behaves deterministically
- [ ] Progress sync survives application restart

### Security & Privacy
- [ ] Strict Content Security Policy (CSP) active on WebView
- [ ] Ebook JavaScript execution completely blocked (`script-src 'none'`)
- [ ] Ebook content cannot access Tauri IPC (`__TAURI__`) or filesystem
- [ ] Path traversal attacks (`../`, absolute paths) are rejected
- [ ] Catalog credentials (passwords, tokens) never leak into logs or UI
- [ ] Tauri permissions and capabilities strictly scoped to application storage
- [ ] Malicious ZIP archives (path escape, compression bombs) rejected

### Code Quality & Verification
- [ ] TypeScript passes strict typecheck (`pnpm run typecheck`)
- [ ] ESLint passes with zero warnings (`pnpm run lint`)
- [ ] Rust cargo check passes (`cargo check`)
- [ ] Rust clippy passes with zero warnings (`cargo clippy`)
- [ ] All unit test suites pass (`pnpm test`)
- [ ] All integration and E2E test suites pass
- [ ] Android release APK builds without compilation errors
- [ ] Zero known P0 / P1 issues

---

## 20. Autonomous Agent Execution Loop

The ideal autonomous engineering cycle:

```text
┌────────────────────────────────────────────────────────┐
│                   1. READ STATUS.md                    │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│            2. READ ARCHITECTURE & TASKS.YAML           │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                  3. SELECT NEXT TASK                   │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│             4. INSPECT EXISTING CODE & TESTS           │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│         5. IMPLEMENT SMALLEST CORRECT CHANGE           │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│             6. WRITE UNIT & INTEGRATION TESTS          │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│             7. RUN TESTS & STATIC CHECKS               │
│     (Vitest, ESLint, TypeScript, Cargo, Clippy)        │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│         8. BUILD ANDROID TARGET (WHEN REQUIRED)        │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                  9. REVIEW GIT DIFF                    │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│         10. UPDATE DOCUMENTATION & STATUS.MD           │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│               11. COMMIT (CONVENTIONAL)                │
└───────────────────────────┬────────────────────────────┘
                            │
                            └─────────► Loop to Step 1
```

> [!CAUTION]
> **Anti-Pattern to Avoid**:
> `Prompt` ──► `Generate 30,000 unverified lines` ──► `"App Complete!"`
>
> That is the hallmark of fragile prototypes. Rigorous, milestone-by-milestone implementation with continuous automated verification produces software that runs reliably on actual Android devices.
