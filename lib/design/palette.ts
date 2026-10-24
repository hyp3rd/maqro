/** The "Instrument" colour palette as literal hex — the single source for
 *  every renderer that cannot read CSS custom properties: Satori OG routes,
 *  the react-pdf report, HTML email, the global error boundary, the PWA
 *  manifest and the viewport `theme-color`.
 *
 *  Keys are the camelCase names of the CSS tokens in `app/globals.css`
 *  (`mutedForeground` ⇔ `--muted-foreground`). The CSS stores the same
 *  colours as HSL channel triples so Tailwind opacity modifiers keep working;
 *  `palette.test.ts` asserts both sides agree to within one 8-bit step per
 *  channel and that every text/surface pair meets WCAG 2.x AA.
 *
 *  Surface tiers are solid: the Instrument artboards draw translucent panels
 *  over a flat ground, and these are their blended equivalents (dark panels
 *  are white at 4/6/7/9 % over the ground, light panels are ink at
 *  2.5/4.5/6 % over white). Real translucency is reserved for overlays.
 *
 *  `public/offline.html` is static and cannot import this module; the same
 *  test pins its colours to these values. */

export type ThemeName = "light" | "dark";

export type Palette = {
  /** Ground: the flat page colour. */
  background: string;
  foreground: string;
  /** Tier 1: panels and cards. */
  card: string;
  cardForeground: string;
  /** Tier 2: raised overlays (menus, popovers, dialogs). */
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  /** Inset fill on a panel (tracks, wells, chips). */
  muted: string;
  /** Secondary text. */
  mutedForeground: string;
  /** Tertiary text: captions, units, timestamps. */
  faintForeground: string;
  /** Hover / selected fill. */
  accent: string;
  accentForeground: string;
  /** Accent for graphics: arcs, bars, indicators, focus ring. */
  brand: string;
  /** Label on `brandStrong` (and icons on `brand`, which only need 3:1). */
  brandForeground: string;
  /** Fill behind a `brandForeground` label (filled buttons). */
  brandStrong: string;
  /** Brand-coloured text on any surface. */
  brandText: string;
  /** "Now / open / today" marks only. */
  signal: string;
  signalForeground: string;
  success: string;
  successForeground: string;
  warning: string;
  warningForeground: string;
  info: string;
  infoForeground: string;
  /** Destructive-red text on any surface (and faint tints behind it). */
  destructive: string;
  /** Label on `destructiveStrong`. */
  destructiveForeground: string;
  /** Fill behind a `destructiveForeground` label (destructive buttons):
   *  >= 3:1 against every surface. */
  destructiveStrong: string;
  /** Hairlines. Mostly consumed at `/60`, which lands on the artboards'
   *  8 % hairline; full strength is the stronger divider. */
  border: string;
  /** Form-control boundary: >= 3:1 against every surface. */
  input: string;
  ring: string;
  /** Macro fills (graphics, >= 3:1) and their text-safe variants (>= 4.5:1). */
  macroProtein: string;
  macroProteinText: string;
  macroCarbs: string;
  macroCarbsText: string;
  macroFat: string;
  macroFatText: string;
  microFiber: string;
  microSodium: string;
  microPotassium: string;
  microCalcium: string;
  microIron: string;
  microMagnesium: string;
  microZinc: string;
  microVitaminC: string;
  microVitaminD: string;
  microVitaminB12: string;
};

const LIGHT: Palette = {
  background: "#FFFFFF",
  foreground: "#0A0A0F",
  card: "#F9F9F9",
  cardForeground: "#0A0A0F",
  popover: "#FFFFFF",
  popoverForeground: "#0A0A0F",
  primary: "#0A0A0F",
  primaryForeground: "#FFFFFF",
  secondary: "#F4F4F4",
  secondaryForeground: "#0A0A0F",
  muted: "#F4F4F4",
  mutedForeground: "#52525B",
  faintForeground: "#6B6B75",
  accent: "#F0F0F1",
  accentForeground: "#0A0A0F",
  brand: "#7C3AED",
  brandForeground: "#FFFFFF",
  brandStrong: "#7C3AED",
  brandText: "#7C3AED",
  signal: "#0E7490",
  signalForeground: "#FFFFFF",
  success: "#137A3A",
  successForeground: "#FFFFFF",
  warning: "#A84E0A",
  warningForeground: "#FFFFFF",
  info: "#1D4ED8",
  infoForeground: "#FFFFFF",
  destructive: "#B91C1C",
  destructiveForeground: "#FFFFFF",
  destructiveStrong: "#B91C1C",
  border: "#DDDDDE",
  input: "#85858E",
  ring: "#7C3AED",
  macroProtein: "#0284C7",
  macroProteinText: "#0369A1",
  // #D97706 on the artboards; nudged darker so the fill keeps 3:1 on the
  // muted/accent tiers too, not just on white.
  macroCarbs: "#D07206",
  macroCarbsText: "#A84E0A",
  macroFat: "#BE185D",
  macroFatText: "#BE185D",
  microFiber: "#30A657",
  microSodium: "#337FCC",
  microPotassium: "#8C53C6",
  microCalcium: "#2EA1B8",
  microIron: "#D43535",
  microMagnesium: "#30A68E",
  microZinc: "#6464C4",
  microVitaminC: "#F37D16",
  microVitaminD: "#F2B90D",
  microVitaminB12: "#CB4DA1",
};

const DARK: Palette = {
  background: "#07070A",
  foreground: "#EDEDF2",
  card: "#111114",
  cardForeground: "#EDEDF2",
  popover: "#18181B",
  popoverForeground: "#EDEDF2",
  primary: "#EDEDF2",
  primaryForeground: "#07070A",
  secondary: "#161619",
  secondaryForeground: "#EDEDF2",
  muted: "#161619",
  mutedForeground: "#A1A1AA",
  faintForeground: "#8B8B96",
  accent: "#1D1D20",
  accentForeground: "#EDEDF2",
  brand: "#8B5CF6",
  brandForeground: "#FFFFFF",
  brandStrong: "#7A51D8",
  brandText: "#B495F9",
  signal: "#67E8F9",
  signalForeground: "#07070A",
  success: "#4ADE80",
  successForeground: "#07070A",
  warning: "#FCD34D",
  warningForeground: "#07070A",
  info: "#60A5FA",
  infoForeground: "#07070A",
  destructive: "#F87171",
  destructiveForeground: "#FFFFFF",
  // Deeper than the text red so a white label clears 4.5:1 (owner decision:
  // white on red, never dark text on a light red).
  destructiveStrong: "#DC2626",
  border: "#27272A",
  input: "#6B6B75",
  ring: "#8B5CF6",
  macroProtein: "#38BDF8",
  macroProteinText: "#38BDF8",
  macroCarbs: "#FBBF24",
  macroCarbsText: "#FBBF24",
  macroFat: "#EC4899",
  macroFatText: "#EC4899",
  microFiber: "#59CF80",
  microSodium: "#5F9EDD",
  microPotassium: "#AD81DA",
  microCalcium: "#54BFD4",
  microIron: "#E36363",
  microMagnesium: "#51CDB4",
  microZinc: "#8C8CD9",
  microVitaminC: "#F59847",
  microVitaminD: "#F5C73D",
  microVitaminB12: "#DC74BA",
};

export const PALETTE: Readonly<Record<ThemeName, Readonly<Palette>>> = {
  light: LIGHT,
  dark: DARK,
};

/** Print overrides on top of the light palette (`@media print` in
 *  globals.css): white panels and a darker rule so hairlines survive paper. */
export const PAPER = {
  card: "#FFFFFF",
  border: "#C9C9D0",
} as const satisfies Partial<Palette>;

/** Browser chrome colour per theme: the ground, so the status/address bar
 *  reads as part of the page. */
export const THEME_COLOR: Readonly<Record<ThemeName, string>> = {
  light: LIGHT.background,
  dark: DARK.background,
};

function channels(hex: string): [number, number, number] {
  const digits = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (digits === undefined) {
    throw new Error(`Expected a #RRGGBB colour, got "${hex}"`);
  }
  const n = Number.parseInt(digits, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `color` at `alpha` composited over `over`, as opaque hex. For tints in
 *  renderers without reliable alpha (email clients, react-pdf fills). */
export function tint(color: string, alpha: number, over: string): string {
  if (!(alpha >= 0 && alpha <= 1)) {
    throw new RangeError(`alpha must be within [0, 1], got ${alpha}`);
  }
  const fg = channels(color);
  const bg = channels(over);
  return `#${fg
    .map((c, i) =>
      Math.round(bg[i] + (c - bg[i]) * alpha)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}
