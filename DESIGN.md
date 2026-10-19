---
version: alpha
name: educk E-Paper
description: Monochrome, high-contrast design system for an Android EPUB reader built for e-ink displays (BOOX, Bigme).
colors:
  primary: "#111111"
  on-primary: "#FFFFFF"
  secondary: "#444444"
  text-muted: "#777777"
  background: "#FFFFFF"
  background-warm: "#F7F5EE"
  surface-subtle: "#EBEBEB"
  border: "#CCCCCC"
  error: "#900000"
  error-border: "#000000"
typography:
  headline-large:
    fontFamily: Serif
    fontSize: 28px
    fontWeight: 700
    lineHeight: 34px
    letterSpacing: 0px
  headline-medium:
    fontFamily: Serif
    fontSize: 22px
    fontWeight: 700
    lineHeight: 28px
    letterSpacing: 0px
  title-large:
    fontFamily: SansSerif
    fontSize: 20px
    fontWeight: 700
    lineHeight: 26px
    letterSpacing: 0px
  title-medium:
    fontFamily: SansSerif
    fontSize: 17px
    fontWeight: 600
    lineHeight: 22px
    letterSpacing: 0px
  body-large:
    fontFamily: SansSerif
    fontSize: 16px
    fontWeight: 400
    lineHeight: 22px
    letterSpacing: 0px
  body-medium:
    fontFamily: SansSerif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0px
  label-large:
    fontFamily: SansSerif
    fontSize: 14px
    fontWeight: 700
    lineHeight: 18px
    letterSpacing: 0.5px
  label-medium:
    fontFamily: SansSerif
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0.5px
rounded:
  none: 0px
  small: 4px
spacing:
  small: 8px
  medium: 12px
  large: 16px
  xlarge: 24px
components:
  screen:
    backgroundColor: "{colors.background}"
    textColor: "{colors.primary}"
  screen-warm:
    backgroundColor: "{colors.background-warm}"
    textColor: "{colors.primary}"
  top-bar:
    backgroundColor: "{colors.background}"
    textColor: "{colors.primary}"
  book-row:
    backgroundColor: "{colors.background}"
    textColor: "{colors.primary}"
    padding: 16px
  book-row-author:
    textColor: "{colors.secondary}"
    typography: "{typography.body-medium}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.small}"
    padding: 12px
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.primary}"
    rounded: "{rounded.small}"
    padding: 12px
  filter-chip-selected:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.small}"
  search-field:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.primary}"
    rounded: "{rounded.small}"
  divider:
    backgroundColor: "{colors.border}"
    height: 1px
  progress-track:
    backgroundColor: "{colors.surface-subtle}"
    height: 5px
  progress-fill:
    backgroundColor: "{colors.primary}"
    height: 5px
  progress-label:
    textColor: "{colors.text-muted}"
    typography: "{typography.label-medium}"
  error-banner:
    backgroundColor: "{colors.background}"
    textColor: "{colors.error}"
    rounded: "{rounded.small}"
  error-banner-rule:
    backgroundColor: "{colors.error-border}"
    height: 1px
  empty-state:
    textColor: "{colors.secondary}"
    typography: "{typography.body-medium}"
---

## Overview

educk is a text-first EPUB reader for e-ink devices. Every design decision
serves one constraint: **the display is monochrome, slow to refresh, and prone
to ghosting.** The visual language is therefore deliberately austere — solid
fills, hairline borders, no decoration that would force a full-screen repaint.

The identity is "quiet utility". It should read like a well-set paperback page,
not an app. There is no accent color, no gradient, no shadow, and no motion.
Interaction is signaled through **inversion** (black fill, white text) rather
than hue, because inversion is the only emphasis an e-ink panel renders
reliably.

Two backgrounds are supported — pure white and a warm paper white — and the user
may switch between them. Nothing else varies.

## Colors

The palette is high-contrast neutrals with a single reserved error hue. All
pairings meet or exceed WCAG AA (4.5:1); the primary text/background pairing is
roughly 19:1.

- **Primary (`#111111`):** near-black ink. Used for body text, borders, and as a
  *fill* for selected/active states. Not pure `#000000` — a hair off black
  reduces e-ink drive strength and the visible burn-in of fully-saturated pixels
  while keeping maximum legibility.
- **On-primary (`#FFFFFF`):** text shown on a primary fill. This is the inverse
  half of the selection treatment.
- **Secondary (`#444444`):** dark gray for supporting text — author
  names, empty-state copy. Still ~9.7:1 on white.
- **Text-muted (`#777777`):** the lightest text permitted, for low-priority
  metadata such as progress percentages. Deliberately not used for anything the
  user must read.
- **Background (`#FFFFFF`):** default page.
- **Background-warm (`#F7F5EE`):** optional warm paper tone. Softer than pure
  white for long reading sessions; identical text contrast.
- **Surface-subtle (`#EBEBEB`):** inset containers — search field, progress
  track. The only fill lighter than the border.
- **Border (`#CCCCCC`):** hairline dividers and outlines.
- **Error (`#900000`):** dark red, the sole non-neutral. Chosen because it keeps
  ~9.6:1 on white *and* survives greyscale rendering as a clearly darker tone,
  so it still reads as "alert" on a panel with no color.
- **Error-border (`#000000`):** the rule drawn around error banners. Pure black
  here (unlike primary) to be unambiguous at 1dp.

### Selection is inversion, not color

There is no "selected" or "accent" token. A selected element (filter chip,
primary button) is `primary` as `backgroundColor` with `on-primary` as
`textColor`. This is why `button-primary` and `filter-chip-selected` share
values. Do not introduce a hue for emphasis — on e-ink it will not render.

In code, `InvertedBackground`/`InvertedText` are literal aliases of
`primary`/`on-primary`; they are not separate colors.

## Typography

Two families, both resolving to Android platform defaults — **no custom fonts
are bundled**, because embedded font downloads add startup cost and can cause
text reflow on a slow display.

- **Serif** (`headline-large`, `headline-medium`) — system serif (Noto Serif).
  Reserved for the largest titles; evokes book typography.
- **SansSerif** (`title-*`, `body-*`, `label-*`) — system sans (Roboto). All
  functional text.

Sizes are given in `px` here but are `sp` (scaled pixels) in code, so the whole
scale honors the user's system font-size setting for accessibility. Line heights
are set explicitly and generously (1.25–1.4×) — e-ink benefits from extra leading
because pixel response is uneven at tight spacing. Letter spacing is zero except
on `label-*`, which uses `0.5px` to keep short all-caps-ish labels legible.

The full scale, largest to smallest:

| Token | Family | Size / Line | Weight | Use |
| --- | --- | --- | --- | --- |
| `headline-large` | Serif | 28 / 34 | 700 | Screen titles |
| `headline-medium` | Serif | 22 / 28 | 700 | Section titles |
| `title-large` | SansSerif | 20 / 26 | 700 | Book title in row |
| `title-medium` | SansSerif | 17 / 22 | 600 | Dialog / card titles |
| `body-large` | SansSerif | 16 / 22 | 400 | Primary body |
| `body-medium` | SansSerif | 14 / 20 | 400 | Secondary body |
| `label-large` | SansSerif | 14 / 18 | 700 | Buttons, +0.5px |
| `label-medium` | SansSerif | 12 / 16 | 500 | Metadata, +0.5px |

## Layout

Single-column, edge-to-edge, no cards floating on backgrounds. Surfaces are
separated by **hairline borders**, not elevation or gaps.

- **Spacing scale:** `small` 8px, `medium` 12px, `large` 16px, `xlarge` 24px.
  Content uses 16px horizontal gutters; rows use 12–16px vertical padding.
- **Touch targets:** minimum **48dp**. This is a floor, not a suggestion — e-ink
  devices are tapped with fingers and styluses on panels with no hover feedback.
- **Border weights:** 1dp (default divider/outline), 2dp (emphasized or
  selected), 3dp (reserved, currently unused).
- **Density:** book rows are compact and text-only. Covers are optional and, if
  ever added, must be small and fixed-size. The list is the UI.
- **Stability:** layouts must not shift between states. `LazyColumn` items are
  keyed by stable book id so a row never re-animates or reorder-jitters — a
  repositioned row on e-ink leaves a visible ghost.

## Elevation & Depth

**None.** This is a deliberate prohibition, not an omission.

There are no shadows, no blur, no translucency, and no overlapping surfaces.
Depth is expressed only through border weight and the `surface-subtle` fill.
A drop shadow on e-ink renders as a dithered gray smear and forces a full-panel
redraw; it buys nothing.

If a screen appears to need elevation to be understandable, the layout is wrong.

## Shapes

Minimal rounding. Corners are `rounded.none` (0px) or `rounded.small` (4px) —
nothing larger. Large radii waste interior space, look soft against high-contrast
type, and add antialiased edge pixels that ghost on e-ink.

Use `rounded.small` on interactive elements (buttons, chips, fields, banners) so
they read as touchable. Use `rounded.none` on full-bleed surfaces and dividers.

## Components

Components map a name to token references. Variants are separate entries with a
related key.

- **`screen` / `screen-warm`** — page root. Identical text, different background
  (`background` vs `background-warm`). The warm variant is the user-selectable
  reading-paper tone.
- **`top-bar`** — app header. Same fill as `screen`; separated by a 1dp rule, not
  a shadow. Holds icon actions (search, catalog, settings).
- **`book-row`** — the primary repeated element. `background` fill,
  `primary` text, 16px padding. Shows title, author, progress. No ripple, no
  animated state change.
- **`book-row-author`** — the secondary line inside a row: `secondary` text at
  `body-medium`.
- **`button-primary`** — inverted fill (`primary`/`on-primary`), `rounded.small`,
  12px padding. The one loud element on any screen; use sparingly.
- **`button-outline`** — `background` fill with `primary` text and a 1dp outline.
  The quiet counterpart; prefer this over `button-primary` for row-level actions.
- **`filter-chip-selected`** — active filter tab. Uses the same inversion as
  `button-primary`; an unselected chip is `button-outline`.
- **`search-field`** — inset input on `surface-subtle`, `rounded.small`.
- **`divider`** — 1px `border` fill. Full-bleed hairline between rows.
- **`progress-track` / `progress-fill`** — 5px static bar. `track` on
  `surface-subtle`, `fill` on `primary`. **Static only** — it must never animate
  or animate-width; it reports a stored percentage.
- **`progress-label`** — `text-muted` at `label-medium` (e.g. "45%").
- **`error-banner`** — `background` fill, `error` text, `rounded.small`, wrapped
  by `error-banner-rule`. Always paired with a plain-language message and a
  dismiss action.
- **`empty-state`** — centered `secondary` copy at `body-medium` with a single
  call to action.

## Do's and Don'ts

**Do**

- Signal selection and emphasis by **inverting** to `primary`/`on-primary`.
- Keep every text pairing at WCAG AA or better; prefer `primary` for anything
  important.
- Use static indicators — plain text like `[ Importing... ]` — instead of
  spinners or shimmer.
- Keep list-item identity stable (key by id) so rows never ghost or jitter.
- Respect the system font scale; all sizes are `sp` for this reason.
- Use `rounded.small` max, and hairline borders to separate regions.

**Don't**

- Don't add gradients, shadows, blur, translucency, or decorative color.
- Don't animate — no fades, ripples, shimmer, or animated transitions. Screen
  navigation is instant (`EnterTransition.None`/`ExitTransition.None`).
- Don't introduce an accent hue for emphasis or brand; e-ink cannot render it.
- Don't use rounded corners larger than 4px.
- Don't rely on color alone to convey state — pair it with shape, weight, or
  text.
- Don't call vendor-specific display APIs; refresh behavior belongs to the OS.
