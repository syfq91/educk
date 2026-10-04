# ADR 003: Storage Isolation and UUID Paths

## Status
Accepted

## Context
Untrusted OPDS feeds and EPUB packages often include titles with unusual characters, path separators (`/`, `\`), or malicious sequences (`../`, null bytes). Deriving filesystem file/directory names from untrusted metadata introduces path traversal vulnerabilities and cross-platform filesystem encoding bugs.

## Decision
All downloaded books are stored using generated UUIDv4 paths:
`$APPDATA/books/<uuid>/book.epub`
Metadata (title, author, series, publisher) is stored strictly in the SQLite database and never encoded into filesystem paths.

## Consequences
- **Positive**: Complete mitigation of path traversal via malicious book titles.
- **Positive**: Uniform, predictable filesystem layout on all platforms.
- **Negative**: Browsing the raw application data folder in a filesystem explorer displays UUIDs rather than human-readable book titles.
