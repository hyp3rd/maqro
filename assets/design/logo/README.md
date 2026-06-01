# Assets

The Maqro brand keeps its assets light — the landing page and
the in-app UI use real CSS components instead of screenshots,
the iconography comes from Lucide (loaded via CDN), and the
logo is a small geometric SVG mark.

## What's in here

- `logo-mark.svg` — the constructivist μ-mark on its own.
  Four primitives (two rects for stems, one rect for the
  bridge, one circle for the precision dot). Black on
  transparent background.
- `logo-mark-inverse.svg` — same mark, white fill, for dark
  surfaces.
- `logo-wordmark.svg` — horizontal lockup. Mark on the left,
  "MAQRO" set in Manrope-700 with `letter-spacing: 5` (≈ 0.18em
  at 26 px), all-caps. The avant-garde editorial signal.
- `og-card.svg` — placeholder Open Graph card (1200×630),
  white background, brand lockup top-left, headline + trust
  strip below. Built from the same brand atoms.

## Construction notes

The mark is drawn on a 64×74 viewBox:

- Left stem at `(10, 14)` — 8 wide, 56 tall (extends as descender)
- Right stem at `(42, 14)` — 8 wide, 42 tall (stops at baseline)
- Bridge at `(10, 48)` — 40 wide, 8 tall (forms the U at baseline)
- Precision dot at `(58, 10)` — radius 3

The aspect ratio of the bounding glyph is 64:74 ≈ 0.865. When
sizing the mark in CSS, set the height and compute the width as
`calc(<height> * 0.865)`. The mark holds shape down to ~14 px;
below that the precision dot will vanish but the U-form still
reads — adjust accordingly for favicons.

For React/JSX use, inline the SVG with `currentColor` fills so
the mark inherits its color from the parent — that's how both
UI kits in this design system render it.

## What's NOT here, by design

- No photography. Maqro doesn't ship food photos, lifestyle
  imagery, or hero photos. Every "product preview" is rendered
  from real components.
- No textures, no patterns, no decorative SVG illustrations.
- No icon sprite — Lucide is loaded from CDN
  (`https://unpkg.com/lucide@latest/dist/umd/lucide.js`) in the
  design-system HTML; the production app bundles
  `lucide-react`.
- No emoji.
