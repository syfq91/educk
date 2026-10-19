# Design System Implementation

[`DESIGN.md`](../DESIGN.md) ("educk E-Paper", version: alpha) is the single source of
truth for how educk looks and behaves. This document maps that spec onto the codebase
and records where each rule is enforced.

Target constraint: **the display is monochrome, slow to refresh, and prone to ghosting.**

---

## 1. Token layer — `src/styles.css`

All tokens from the `DESIGN.md` frontmatter exist as CSS custom properties on `:root`.

| DESIGN.md section | CSS tokens |
| --- | --- |
| `colors` | `--color-primary`, `--color-on-primary`, `--color-secondary`, `--color-text-muted`, `--color-background`, `--color-background-warm`, `--color-surface-subtle`, `--color-border`, `--color-error`, `--color-error-border` |
| `typography` | `--font-serif`, `--font-sans` (+ `--font-mono` for code/CFI/URL text only) |
| `rounded` | `--radius-none: 0px`, `--radius-small: 4px` |
| `spacing` | `--space-small: 8px`, `--space-medium: 12px`, `--space-large: 16px`, `--space-xlarge: 24px` |
| Layout rules | `--border-hairline: 1px` (1dp), `--border-emphasis: 2px` (2dp), `--touch-min: 48px` |
| Components | styled per class, see §3 |

Rules for the token layer:

- **No new hues.** Emphasis is *inversion* (`--color-primary` fill with
  `--color-on-primary` text), never a color. `error` is the only non-neutral.
- **Sizes are `rem`, not `px`**, so the browser/system font scale is honored —
  the web analogue of the `sp` unit the spec requires. Structural values
  (spacing, radius, touch floor) stay in `px`.
- **Fonts are never bundled.** `--font-serif` resolves to the system serif
  (Noto Serif) and `--font-sans` to the system sans (Roboto) on Android.
- **Exactly two backgrounds.** `:root` is white;
  `:root[data-paper="warm"]` re-points `--color-background` at the warm paper
  token. Every surface reads `var(--color-background)`, so the whole app follows
  the switch with no per-component code.

### The paper switch

`src/features/settings/paper.ts` owns the preference (Settings → Appearance):

- `PaperSettingController` binds `.paper-toggle .btn-paper`, applies
  `data-paper` to the document root, syncs the `active` class, and reports the
  change to its caller so the reader's paper controls stay in step.
- **There is one preference, not two.** The reader's White/Warm buttons write
  the same value (`setPaper`), and `.reader-overlay` reads
  `var(--color-background)` — so the reading surface and the app chrome can
  never disagree. `reader.settings.theme` is kept in SQLite as part of the
  `ReaderSettings` contract but is *not* restored; `localStorage` is
  authoritative for the paper.
- The preference is an *interface* preference, not application state, so it
  lives in `localStorage` (`educk.paper`) rather than SQLite.
- Storage failures fall back to white; they must never break the UI.

---

## 2. Rules enforced in `src/styles.css`

| DESIGN.md rule | How it is enforced |
| --- | --- |
| No shadows, elevation, blur, translucency | No `box-shadow`, `text-shadow`, `filter`, `backdrop-filter`, or alpha fills anywhere. Overlapping surfaces (modals, suggestion list, drawers) are separated by a **2dp** `--color-primary` rule instead. |
| No animation | No `transition`, `animation`, or `@keyframes`. Bars hide with an instant `transform`; navigation is display-based. |
| No gradients / shimmer | The shimmer skeleton was replaced by the static text indicator `[ Loading... ]` (`.loading-label`). |
| Radius ≤ 4px | Only `--radius-none` and `--radius-small` are used; pills (`9999px`) are gone. |
| Hairline separation | Stacked screen sections share a single 1px rule (`margin-bottom: -1px`); list rows use `border-bottom` dividers with **no gaps**; the feed grid is a true hairline grid (cells carry `border-right`/`border-bottom`). |
| 48px touch floor | `button`, `select`, text `input`, `textarea`, and `range` all get `min-height: var(--touch-min)`; buttons also get `min-width`. |
| Static progress | `.book-progress-*` and `.download-progress-*` are 5px, `--color-surface-subtle` track + `--color-primary` fill, with no transition. |
| Inversion for selection | `.btn-primary`, `.nav-item.active`, `.btn-toggle.active`, `.theme-btn.active`, `.btn-paper.active`, `.facet-chip.active` = `--color-primary` / `--color-on-primary`. |
| Pair state with shape/weight | Active TOC item: 2dp left rule + weight. Disabled: `--color-surface-subtle` fill + `--color-text-muted`. Errors: `--color-error` text inside a pure-black `--color-error-border` rule. |
| Contrast | Body/primary pair ≈ 19:1; `--color-secondary` ≈ 9.7:1; `--color-error` ≈ 9.6:1. `--color-text-muted` is used only for low-priority metadata (percentages, dates, sizes, URLs). |
| No vendor display APIs | Refresh behavior belongs to the OS; nothing in the frontend calls display APIs. |

`.hidden { display: none !important; }` is the single state utility — it must win
over component display rules, which is why it is `!important`.

---

## 3. Component map (class → DESIGN.md component)

| DESIGN.md component | CSS class(es) |
| --- | --- |
| `screen` / `screen-warm` | `.app-layout`, `body` (background follows `data-paper`) |
| `top-bar` | `.app-header` (1dp rule, no shadow) |
| `book-row` / `book-row-author` | `.book-card` / `.book-author` |
| `button-primary` | `.btn-primary` (used sparingly: section CTAs and modal submits) |
| `button-outline` | `.btn-secondary`, `.btn-retry`, and all row-level actions (`.btn-open`, `.btn-delete`, `.btn-browse`, `.btn-acquire`, `.btn-details`) |
| `filter-chip-selected` | `.facet-chip.active` (unselected = outline) |
| `search-field` | `.feed-search input`, `.form-group input`, `.setting-select`, `.library-sort-select` |
| `divider` | row `border-bottom`, `.app-header` / `.feed-header` / `.feed-pagination` rules |
| `progress-track` / `progress-fill` | `.book-progress-bar` / `.book-progress-fill`, `.download-progress-track` / `.download-progress-fill` |
| `progress-label` | `.book-progress-label`, `.book-progress-text`, `.page-info` |
| `error-banner` / `error-banner-rule` | `.error-state`, `.feed-error`, `.missing-badge` |
| `empty-state` | `.empty-state` — secondary copy at `body-medium` plus a single call to action |

Type scale as implemented (values in `rem`, base 16px):

| Token | Family | Size / line | Weight | Where |
| --- | --- | --- | --- | --- |
| `headline-large` | Serif | 28 / 34 | 700 | `.library-title`, `.view-title` |
| `headline-medium` | Serif | 22 / 28 | 700 | `.app-title`, `.feed-title` |
| `title-large` | Sans | 20 / 26 | 700 | `.book-title` |
| `title-medium` | Sans | 17 / 22 | 600 | dialog/section titles (`.modal h3`, `.spike-title`, `.entry-title`, `.catalog-info h3`) |
| `body-large` | Sans | 16 / 22 | 400 | base text, `.toc-link`, inputs |
| `body-medium` | Sans | 14 / 20 | 400 | secondary copy, authors, descriptions |
| `label-large` | Sans | 14 / 18, +0.5px | 700 | buttons, nav labels, chips, reader title |
| `label-medium` | Sans | 12 / 16, +0.5px | 500 | metadata, badges, field labels, progress labels |

---

## 4. Reader themes

`ReaderTheme` (`src/domain/reader.ts`) is `"white" | "warm"` — the two papers and
nothing else. There is no dark or accent theme.

- The reader's White/Warm buttons call `setPaper()`, so the reading surface and
  the rest of the chrome always show the same background (see §1).
- `normalizeReaderTheme()` maps unknown values to a supported paper and migrates
  pre-DESIGN.md names (`light`/`dark` → `white`, `sepia` → `warm`). It is
  applied at the adapter, the controller, and on `applySettings()`, so a legacy
  value can never reintroduce a third background.
- `FoliateReaderAdapter` renders book content on the paper color with `#111111`
  ink. **Links are distinguished by underline, not hue** (there is no accent
  color on e-ink).

---

## 5. Known deviations

- **Feed grid view keeps covers.** DESIGN.md prefers text-only rows ("the
  list is the UI"); the Grid/List toggle from milestone M8 is retained as a
  user-facing feature, with covers bounded by the fixed grid track and all
  card styling brought back in line (hairline separators, 0/4px radius, no
  shadow or hover motion). List view — the default — follows the spec exactly.
- **Reader font size is expressed in `px`** because foliate-js renders book
  content inside a sandboxed iframe where the outer font scale does not
  propagate. All application chrome uses `rem` and therefore honors the system
  font scale as required.
- **The `.hidden` utility was missing entirely** before this pass: panels,
  empty states, the download progress block, and the OPML file input were all
  rendered despite carrying `hidden`. It is now a single `!important` rule.

## 6. Checklist for new UI

1. Read the relevant section of `DESIGN.md` first.
2. Use only existing tokens — no new colors, radii, or type sizes.
3. Selected/active → inversion; never a hue, never a shadow.
4. Interactive elements need a 48px touch target and a text label for state.
5. Indicators are static text (`[ Loading... ]`), never spinners or shimmer.
6. Repeated rows are hairline-separated and keyed by stable id — no reflow ghosts.
7. Add/extend a unit test for any new behavior, then run:
   `pnpm run check` (tsc + eslint + vitest) and `pnpm run build`.
