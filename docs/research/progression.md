# OPDS Progression 1.0 Research & Synchronization Model

## Overview
OPDS Progression 1.0 specifies a lightweight RESTful synchronization layer to track reading progress across multiple client devices for books acquired via OPDS.

## Data Model & Payload
A progression object represents a discrete reading location:

```json
{
  "modified": "2026-10-04T04:15:00Z",
  "device": "educk-android-8a7e3d1c",
  "locator": {
    "href": "text/chapter02.xhtml",
    "type": "application/xhtml+xml",
    "title": "Chapter 2: The Departure",
    "locations": {
      "cfi": "/6/14[chap02]!/4/2/1:0",
      "progression": 0.42,
      "totalProgression": 0.18
    }
  }
}
```

- **`modified`**: UTC timestamp formatted in ISO 8601, indicating when the user last read at this location.
- **`device`**: Identifier to distinguish devices and prevent echo loops.
- **`locator`**: Readium-compatible locator containing:
  - `href`: Spine item reference.
  - `locations.cfi`: Precise EPUB Canonical Fragment Identifier provided by Foliate.
  - `locations.totalProgression`: Normalized value [0.0 - 1.0] representing percentage through the whole book.

## Synchronization Protocol & Endpoints
1. **GET Progression Link**:
   - Discovered in OPDS book entry links: `rel="http://opds-spec.org/progression"`.
   - `GET <progression_url>` returns current remote progression or 404 (if not yet started).
2. **PUT Progression Link**:
   - `PUT <progression_url>` with JSON payload updates remote progression.
   - Status 200/204 indicates success.

## Local-First Architecture & Conflict Algorithm
1. **Immediate Local Persistence**:
   - On reader `relocate` event, update SQLite `reading_progress` immediately (debounced to avoid flash write churn).
   - Reading navigation NEVER awaits network synchronization.
2. **Asynchronous Sync Queue**:
   - Synchronization runs asynchronously in the background.
   - Triggers:
     - On opening a book (pull remote check).
     - On closing/exiting reader (push local progress).
     - On Android app backgrounding (push local progress).
     - Debounced periodic background sync (every 60s while active reading with network).
3. **Conflict Resolution Strategy**:
   - Compare `modified` timestamps and versions:
     - **Local > Remote**: Push local to remote.
     - **Remote > Local**: If remote is strictly newer and greater progression, update local position or prompt user to jump ahead.
     - **Offline / Network Failure**: Retain `sync_status = 'pending'` in SQLite and retry when network becomes reachable.
