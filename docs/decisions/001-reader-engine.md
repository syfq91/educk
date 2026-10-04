# ADR 001: Vendoring foliate-js via Submodule / Pinned Checkout

## Status
Accepted

## Context
`foliate-js` provides comprehensive EPUB 2/3 rendering, CFI calculation, and `<foliate-view>` web component logic. However, upstream maintainers do not maintain a stable versioned npm package and explicitly recommend vendoring or submoduling the repository due to ongoing API iterations.

## Decision
We vendor `foliate-js` under `vendor/foliate-js` pinned to upstream commit `78914aef4466eb960965702401634c2cb348e9b1` with tracked `COMMIT` metadata.
Application code will never directly import or invoke `foliate-js` functions across the UI; instead, all interactions occur through an application-owned `Reader` abstraction (`FoliateReaderAdapter`).

## Verification & Spike Results (Milestone M2)
- Successfully rendered local EPUB 3 fixtures inside WebView under strict Content Security Policy (`script-src 'none'`).
- Verified CFI extraction, pagination forward/backward, and position restoration.
- Confirmed that script elements inside untrusted EPUBs are completely neutralized.

## Consequences
- **Positive**: Complete control over rendering engine stability; no sudden breaking upstream updates.
- **Positive**: Zero external runtime npm dependencies added.
- **Positive**: Fully sandboxed execution adhering to educk threat model.
- **Negative**: Upstream improvements require manual review and vendoring updates.
