# ADR 001: Vendoring foliate-js via Submodule / Pinned Checkout

## Status
Accepted

## Context
`foliate-js` provides comprehensive EPUB 2/3 rendering, CFI calculation, and `<foliate-view>` web component logic. However, upstream maintainers do not maintain a stable versioned npm package and explicitly recommend vendoring or submoduling the repository due to ongoing API iterations.

## Decision
We vendor/submodule `foliate-js` under `vendor/foliate-js` pinned to a specific stable commit.
Application code will never directly import or invoke `foliate-js` functions across the UI; instead, all interactions must occur through an application-owned `Reader` abstraction (`FoliateReaderAdapter`).

## Consequences
- **Positive**: Complete control over rendering engine stability; no sudden breaking upstream updates.
- **Positive**: Easy to inspect and debug rendering internals if needed.
- **Negative**: Manual updates required when upgrading foliate-js.
