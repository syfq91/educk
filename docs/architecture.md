# Architecture Specification — educk

## Architectural Principles
The architecture is designed around strict separation of concerns, defensive security boundaries, and offline-first data flows.

```
┌────────────────────────────────────────────────────────┐
│                        UI Layer                        │
│   (Catalog, Library, Reader Screen, Settings)          │
└────────────┬──────────────┬─────────────┬──────────────┘
             │              │             │
             ▼              ▼             ▼
   ┌────────────────┐┌────────────┐┌──────────────┐
   │  OPDS Client   ││  Library   ││ Reader State │
   │  (Atom Parser) ││  Manager   ││   Manager    │
   └────────┬───────┘└──────┬─────┘└──────┬───────┘
            │               │             │
            ▼               │             ▼
   ┌────────────────┐       │      ┌──────────────┐
   │  Progression   │       │      │    Reader    │
   │ Synchronization│       │      │  Abstraction │
   └────────┬───────┘       │      └──────┬───────┘
            │               │             │
            │               │             ▼
            │               │      ┌──────────────┐
            │               │      │  foliate-js  │
            │               │      │   Adapter    │
            │               │      └──────────────┘
            ▼               ▼
┌────────────────────────────────────────────────────────┐
│                   Tauri IPC Boundary                   │
└───────────────────────────┬────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
┌───────────────────────┐       ┌───────────────────────┐
│ Rust Download Engine  │       │     Rust SQLite       │
│  (reqwest, tokio)     │       │     Data Store        │
└───────────┬───────────┘       └───────────────────────┘
            ▼
┌───────────────────────┐
│ Encrypted/App-Scoped  │
│  Filesystem Storage   │
└───────────────────────┘
```

---

## The 7 Core Architectural Concerns

1. **OPDS Engine**:
   - Parses OPDS 1.2 Atom feeds, navigation entries, acquisition links, and metadata.
   - Completely independent from UI components and the reader.
2. **Download Engine (Rust)**:
   - Streams downloads directly to `$APPDATA/books/<book-id>/book.epub.part`.
   - Validates EPUB archive integrity before atomically renaming to `book.epub`.
   - Emits progress events and handles network disconnects and cancellations.
3. **Local Library**:
   - Manages local book metadata, read status, dates, and cover images cached in application storage.
   - Never accesses network directly; operates strictly from SQLite.
4. **Reader Abstraction**:
   - Unified interface owning ebook lifecycle:
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
   - Hides `foliate-js` completely behind `FoliateReaderAdapter`.
5. **Reading Progress Manager**:
   - Captures `relocate` events from the Reader.
   - Debounces updates and writes immediately to local SQLite.
6. **Progression Synchronization (OPDS Progression 1.0)**:
   - Manages asynchronous remote sync with OPDS server.
   - Pulls remote progress on open; pushes local progress on exit/background.
   - Handles offline queues and timestamp conflict resolution.
7. **UI Layer**:
   - Reactive views for Library, Catalog, Reader, and Settings.
   - Zero direct database SQL or low-level protocol parsing.

---

## Native vs Web Responsibilities

| Responsibility | Layer | Technology |
| :--- | :--- | :--- |
| UI & User Interaction | Frontend | TypeScript, CSS |
| Ebook Rendering | Frontend | `foliate-js` via adapter |
| Feed Parsing & Validation | Frontend | Browser DOMParser + TS Models |
| File Download & Streaming | Backend | Rust (`reqwest`, `tokio`) |
| Metadata & State Persistence | Backend | SQLite via Rust / Tauri Plugin |
| Storage & Sandboxing | Native | Android scoped internal app storage |
