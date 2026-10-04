# Product Specification — educk

## Vision
**educk** is a lightweight, privacy-focused, DRM-free ebook reader designed for Android using Tauri 2 and web technologies. It prioritizes offline reliability, reading comfort, complete ownership of content, and open standards (OPDS 1.2 & OPDS Progression 1.0).

---

## Core Principles
1. **Download-First**: Books must be downloaded in full before opening. The reading experience never streams content or halts on network buffering.
2. **Offline-Reliable**: Once downloaded, books and the library work completely offline without internet connectivity.
3. **DRM-Free**: The application exclusively reads DRM-free publications (EPUB 2 & 3).
4. **Open Standards**: Catalogs are managed via OPDS 1.2 feeds; reading progress is synchronized via OPDS Progression 1.0.

---

## User Personas & Key Flows

### 1. Catalog Browsing & Book Acquisition
- User adds an OPDS 1.2 catalog URL (with optional HTTP Basic or Bearer credentials).
- User navigates catalog feeds, searches titles, inspects book details (synopsis, author, publisher, cover).
- User triggers download. The app atomically downloads the book into private app storage and updates the local library.

### 2. Reading
- User opens a book from the local library.
- Reader displays paginated or continuous text with custom theme (light, sepia, dark) and adjustable font size.
- Page navigation via tap zones, swipe gestures, or chapter table of contents.
- App records precise reading position (EPUB CFI and percentage).

### 3. Progression Synchronization
- When reading or exiting a book, progress is persisted locally.
- When an active network connection exists and the OPDS source supports Progression 1.0, progress is asynchronously synced to the server.
- Upon opening a book, if remote progress is newer, the user can seamlessly resume where they left off on another device.

---

## Scope & Non-Goals

### Supported in MVP
- EPUB 2 and EPUB 3 rendering.
- OPDS 1.2 catalog browsing, pagination, search, and acquisition.
- Local SQLite library database.
- Atomic download engine with progress and cancellation.
- Local reading position tracking and OPDS Progression 1.0 sync.
- Light, dark, and sepia reader themes with font sizing.

### Explicitly Excluded (Out of Scope)
- DRM systems of any kind.
- Ebook streaming.
- Audiobooks and fixed-layout multimedia EPUBs.
- Cloud accounts or proprietary sync services (outside OPDS).
- Social features, public reviews, or recommendations.
- OPDS 2.0 (reserved for future milestones).
