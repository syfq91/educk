# Performance Engineering & Resource Targets

This document outlines the performance architecture, budgets, monitoring hooks, and memory optimization strategies for educk (Milestone M16).

---

## 1. Performance Budgets

| Metric | Target | Verification Method | Enforcement |
| :--- | :--- | :--- | :--- |
| **Cold Startup Time** | `< 2.0s` to interactive library | W3C User Timing API (`performance.mark` / `performance.measure`) | `AppProfiler.measureStartup()` budget: 2000ms |
| **Library Scrolling** | 60 fps with 500+ books | Batch SQL loading, DOM event delegation, CSS `content-visibility: auto` | Automated N+1 query regression tests + layout profiling |
| **Page Turn Latency** | `< 100 ms` perceived latency | W3C User Timing API (`educk:last-page-turn`) | `AppProfiler.measurePageTurn()` budget: 100ms |
| **Download Memory Overhead** | `< 20 MB` RAM during download | Native Rust `reqwest` streaming directly to disk | Chunked stream processing without in-memory buffering |
| **EPUB Parsing Memory** | `< 50 MB` RAM for 100 MB EPUB | `foliate-js` ZipReader lazy section extraction | On-demand spine loading and DOM node recycling |

---

## 2. Cold Startup Optimization (< 2.0s)

### Architecture
Cold startup is timed from application bootstrap (`index.html` load) to the moment the offline local library is fully interactive with rendered book cards.

1. **`AppProfiler` Service (`src/services/performance/profiler.ts`)**:
   - Leverages native browser `performance.mark()` and `performance.measure()`.
   - Records key milestones:
     - `educk:cold-start`: Initial script execution.
     - `educk:db-ready`: SQLite database initialized and migrations applied.
     - `educk:library-ready`: Books and reading progress fetched and rendered.
2. **Startup Lifecycle Integration (`src/main.ts`)**:
   - `profiler.markColdStart()` is triggered at top-level entry.
   - `profiler.markDatabaseReady()` is marked immediately following `DatabaseService.initialize()`.
   - `profiler.markLibraryReady()` is marked when the library controller completes initial render.
   - Outputs performance diagnostic summary in non-production or debug mode:
     ```
     [Performance] Cold startup complete: 142.30ms (DB: 45.10ms, Library: 38.20ms)
     ```

---

## 3. Library Scalability & 60 FPS Scrolling (500+ Books)

Rendering a large library (500+ books) on Android devices presents three potential bottlenecks: N+1 database queries, DOM event listener overhead, and CSS layout/paint thrashing.

### 3.1. Batch Progress Loading (Eliminating N+1 Queries)
- **Problem**: Querying `progressRepo.findByBookId(id)` per book generates 500 synchronous or asynchronous SQLite round-trips (`SELECT * FROM reading_progress WHERE book_id = ?`).
- **Solution**: Implemented `ProgressRepository.findAll()` in SQLite (`SELECT * FROM reading_progress`).
- **Result**: Exactly 1 database query executes during library load regardless of library size:
  ```typescript
  // src/features/library/library-controller.ts
  const allProgress = await this.progressRepo.findAll();
  const progressMap = new Map(allProgress.map(p => [p.bookId, p]));
  ```

### 3.2. Single Container Event Delegation
- **Problem**: Registering click handlers on every card (`.book-card`) and action button (`.btn-delete`) allocates 1,000–1,500 event listeners and closures in V8 heap memory.
- **Solution**: A single delegated click listener is mounted on `#library-list`:
  ```typescript
  this.elements.list.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    const card = target.closest<HTMLElement>(".book-card");
    if (!card) return;
    const bookId = card.dataset.bookId;
    if (!bookId) return;

    const deleteBtn = target.closest<HTMLButtonElement>(".btn-delete");
    if (deleteBtn) {
      e.stopPropagation();
      await this.deleteBook(bookId);
      return;
    }

    await this.openBook(bookId).catch(() => {});
  });
  ```

### 3.3. CSS `content-visibility: auto`
- **Problem**: Rendering 500 book cards creates 5,000+ DOM nodes, forcing the browser layout engine to calculate styles and paint offscreen nodes on every scroll event.
- **Solution**: Added `content-visibility: auto` with `contain-intrinsic-size` in `src/styles.css`:
  ```css
  .book-card {
    content-visibility: auto;
    contain-intrinsic-size: auto 112px;
  }
  .entry-card {
    content-visibility: auto;
    contain-intrinsic-size: auto 90px;
  }
  ```
- **Result**: The browser skips rendering, layout, and painting for offscreen cards until they enter the viewport, maintaining 60 FPS smooth scrolling.

---

## 4. Page Turn Latency (< 100 ms)

### Optimization & Monitoring
- Foliate-js manages paginated viewport layout with CSS column transforms and offscreen section pre-rendering.
- The `AppProfiler.measurePageTurn(fn)` helper wraps navigation actions to record perceived latency and flag budget violations:
  ```typescript
  const { result, durationMs } = await profiler.measurePageTurn(() => reader.next());
  ```
- If a page turn exceeds 100 ms, a performance warning is logged in the profiler.

---

## 5. Streaming Memory Architecture (< 20 MB Download RAM)

### Rust Download Engine (`src-tauri/src/downloads/engine.rs`)
- **Direct-to-Disk Chunked Streaming**:
  - The native Rust download engine consumes the HTTP response via `reqwest::Response::bytes_stream()`.
  - As each 8 KB chunk arrives from the network socket, it is written directly to the `.part` file on disk via `std::fs::File::write_all`.
  - The application never calls `response.bytes().await` or buffers full book payloads in memory.
  - Peak download memory overhead remains `< 20 MB` even when downloading multi-hundred-megabyte EPUBs or comic archives.

---

## 6. EPUB Parsing & Lazy Loading (< 50 MB Reader RAM)

### Foliate-js Lazy Zip Decompression
- `foliate-js` utilizes an uncompressed/deflated ZIP reader that reads central directory headers without decompressing the entire archive into RAM.
- Spine elements (XHTML chapters) and embedded assets (images, fonts, stylesheets) are only decompressed from the ZIP on demand when navigated to.
- When moving between chapters, previous chapter DOM representations are detached from the document, keeping memory usage constant (< 50 MB) regardless of total EPUB file size.
