import manifest from "@/app/manifest";
import tailwindConfig from "@/tailwind.config.mjs";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PALETTE,
  PAPER,
  type Palette,
  THEME_COLOR,
  type ThemeName,
  tint,
} from "./palette";

/** Guards for the "Instrument" token layer: app/globals.css (HSL triples the
 *  DOM reads), lib/design/palette.ts (hex for renderers that cannot read CSS
 *  variables) and tailwind.config.mjs must describe the same colours, and
 *  every text/surface pair must meet WCAG 2.x AA in both themes. */

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const CSS = read("app/globals.css");
const THEMES: ThemeName[] = ["light", "dark"];

// ── CSS helpers ──────────────────────────────────────────────────────────

/** Body of the first `{ … }` block whose prelude ends with `selector`,
 *  searching from `from`. */
function block(source: string, selector: string, from = 0): string {
  const at = source.indexOf(`${selector} {`, from);
  if (at < 0) throw new Error(`No "${selector} {" block after ${from}`);
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      return source.slice(open + 1, i);
    }
  }
  throw new Error(`Unbalanced "${selector}" block`);
}

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

const HSL_TRIPLE = /^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%$/;

function colourTokens(body: string): Map<string, string> {
  return new Map([...declarations(body)].filter(([, v]) => HSL_TRIPLE.test(v)));
}

type Rgb = [number, number, number];

function hslToRgb(triple: string): Rgb {
  const m = HSL_TRIPLE.exec(triple);
  if (!m) throw new Error(`Not an HSL triple: ${triple}`);
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map(
    (c) => c * 255,
  ) as Rgb;
}

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const kebab = (key: string) =>
  key.replace(/[A-Z]/g, (c) => `-${c}`).toLowerCase();

// ── WCAG 2.x contrast ────────────────────────────────────────────────────

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT_TOKENS = colourTokens(block(CSS, ":root"));
const DARK_TOKENS = colourTokens(block(CSS, ".dark"));
const CSS_TOKENS: Record<ThemeName, Map<string, string>> = {
  light: LIGHT_TOKENS,
  dark: DARK_TOKENS,
};

/** Colour as the browser renders it, from the CSS (not the palette), so the
 *  contrast checks hold for what users actually see. */
function rendered(theme: ThemeName, key: keyof Palette): Rgb {
  const triple = CSS_TOKENS[theme].get(kebab(key));
  if (triple === undefined) throw new Error(`--${kebab(key)} missing`);
  return hslToRgb(triple);
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("globals.css tokens ⇔ lib/design/palette.ts", () => {
  for (const theme of THEMES) {
    it(`${theme}: declares exactly the palette's colour tokens`, () => {
      const expected = Object.keys(PALETTE[theme]).map(kebab).sort();
      expect([...CSS_TOKENS[theme].keys()].sort()).toEqual(expected);
    });

    it(`${theme}: every token matches its hex to within one 8-bit step`, () => {
      const drift: string[] = [];
      for (const [key, hex] of Object.entries(PALETTE[theme])) {
        const css = rendered(theme, key as keyof Palette);
        const want = hexToRgb(hex);
        if (css.some((c, i) => Math.abs(c - want[i]) > 1)) {
          drift.push(
            `--${kebab(key)} renders ${css.map(Math.round)}, palette ${hex}`,
          );
        }
      }
      expect(drift).toEqual([]);
    });
  }

  it("keeps the dark tokens screen-only so print resolves the light palette", () => {
    const screen = block(CSS, "@media screen");
    expect(colourTokens(block(screen, ".dark"))).toEqual(DARK_TOKENS);
    // Exactly one `.dark {` token block, and it is the screen-scoped one.
    expect(CSS.split(".dark {").length - 1).toBe(1);
  });

  it("print overrides only the paper tokens, with PAPER's values", () => {
    const print = colourTokens(block(block(CSS, "@media print"), ":root"));
    expect([...print.keys()].sort()).toEqual(
      Object.keys(PAPER).map(kebab).sort(),
    );
    for (const [key, hex] of Object.entries(PAPER)) {
      const css = hslToRgb(print.get(kebab(key)) ?? "");
      const want = hexToRgb(hex);
      expect(css.every((c, i) => Math.abs(c - want[i]) <= 1)).toBe(true);
    }
  });
});

describe("WCAG AA contrast", () => {
  const SURFACES = [
    "background",
    "card",
    "popover",
    "muted",
    "accent",
  ] as const;
  /** Text drawn directly on any surface tier: >= 4.5:1. */
  const TEXT_ON_SURFACES = [
    "foreground",
    "mutedForeground",
    "faintForeground",
    "brandText",
    "signal",
    "macroProteinText",
    "macroCarbsText",
    "macroFatText",
    "success",
    "warning",
    "info",
    "destructive",
  ] as const;
  /** Foreground/background pairs: >= 4.5:1. */
  const TEXT_PAIRS: [keyof Palette, keyof Palette][] = [
    ["cardForeground", "card"],
    ["popoverForeground", "popover"],
    ["primaryForeground", "primary"],
    ["secondaryForeground", "secondary"],
    ["accentForeground", "accent"],
    ["brandForeground", "brandStrong"],
    ["signalForeground", "signal"],
    ["successForeground", "success"],
    ["warningForeground", "warning"],
    ["infoForeground", "info"],
    ["destructiveForeground", "destructiveStrong"],
  ];
  /** Graphics, control boundaries and filled-control fills (WCAG 1.4.11):
   *  >= 3:1 on any surface. */
  const GRAPHICS_ON_SURFACES = [
    "brand",
    "ring",
    "input",
    "signal",
    "macroProtein",
    "macroCarbs",
    "macroFat",
    "destructiveStrong",
  ] as const;

  for (const theme of THEMES) {
    it(`${theme}: text on every surface tier >= 4.5:1`, () => {
      const failures: string[] = [];
      for (const fg of TEXT_ON_SURFACES) {
        for (const bg of SURFACES) {
          const ratio = contrast(rendered(theme, fg), rendered(theme, bg));
          if (ratio < 4.5) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)}`);
        }
      }
      expect(failures).toEqual([]);
    });

    it(`${theme}: foreground/fill pairs >= 4.5:1`, () => {
      const failures = TEXT_PAIRS.flatMap(([fg, bg]) => {
        const ratio = contrast(rendered(theme, fg), rendered(theme, bg));
        return ratio < 4.5 ? [`${fg} on ${bg}: ${ratio.toFixed(2)}`] : [];
      });
      expect(failures).toEqual([]);
    });

    it(`${theme}: graphics and input borders >= 3:1 on every surface`, () => {
      const failures: string[] = [];
      for (const fg of GRAPHICS_ON_SURFACES) {
        for (const bg of SURFACES) {
          const ratio = contrast(rendered(theme, fg), rendered(theme, bg));
          if (ratio < 3) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)}`);
        }
      }
      // Icons on the raw brand fill (e.g. the quick-add key).
      const icon = contrast(
        rendered(theme, "brandForeground"),
        rendered(theme, "brand"),
      );
      if (icon < 3)
        failures.push(`brandForeground on brand: ${icon.toFixed(2)}`);
      expect(failures).toEqual([]);
    });
  }

  it("destructive buttons carry a white label in both themes", () => {
    // Owner decision: white text on a deeper red, never dark text on a light
    // red. The contrast floor itself is in the foreground/fill pairs above.
    for (const theme of THEMES) {
      expect(PALETTE[theme].destructiveForeground).toBe("#FFFFFF");
    }
  });
});

describe("destructive fills", () => {
  /** Source files that render DOM classes. */
  const SOURCES = ["app", "components", "hooks", "lib"].flatMap((dir) => {
    const files: string[] = [];
    const walk = (at: string): void => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const full = path.join(at, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          /\.tsx?$/.test(entry.name) &&
          !/\.test\.tsx?$/.test(entry.name)
        )
          files.push(full);
      }
    };
    walk(path.join(ROOT, dir));
    return files;
  });

  /** `destructive` is the text-safe red; in dark mode it is too light to
   *  carry the white `destructive-foreground` label. Solid fills must use
   *  `destructive-strong`; `destructive` may only appear as a faint tint
   *  (<= /20) behind `text-destructive`. */
  it("solid destructive fills use destructive-strong", () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const where = `${path.relative(ROOT, file)}:${i + 1}`;
        for (const m of line.matchAll(
          /\bbg-destructive(?:\/(\d+))?(?![-\w])/g,
        )) {
          if (m[1] === undefined || Number(m[1]) > 20) {
            offenders.push(`${where} ${m[0]}`);
          }
        }
        if (
          line.includes("text-destructive-foreground") &&
          !line.includes("bg-destructive-strong")
        ) {
          offenders.push(`${where} destructive-foreground off its fill`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("tailwind.config.mjs", () => {
  const extend = tailwindConfig.theme?.extend ?? {};

  it("maps every theme colour token (micro accents stay inline-only)", () => {
    const mapped = new Set(
      [...JSON.stringify(extend.colors).matchAll(/var\(--([a-z0-9-]+)\)/g)].map(
        (m) => m[1],
      ),
    );
    const unmapped = [...LIGHT_TOKENS.keys()].filter(
      (name) => !name.startsWith("micro-") && !mapped.has(name),
    );
    expect(unmapped).toEqual([]);
  });

  it("derives the whole radius scale from --radius", () => {
    const radius = extend.borderRadius as Record<string, string>;
    expect(Object.keys(radius).sort()).toEqual(
      ["2xl", "DEFAULT", "lg", "md", "sm", "xl"].sort(),
    );
    for (const value of Object.values(radius)) {
      expect(value).toContain("var(--radius)");
    }
  });

  it("gives every named sub-12px size the same touch floor as its literal twin", () => {
    const sizes = extend.fontSize as Record<string, [string, unknown]>;
    const floor = new Map<string, string>();
    const coarse = CSS.indexOf("Readability floor for touch");
    for (const m of block(CSS, "@media (pointer: coarse)", coarse).matchAll(
      /([^{}]+)\{\s*font-size:\s*([^;]+);/g,
    )) {
      for (const selector of m[1].split(",")) floor.set(selector.trim(), m[2]);
    }
    const named = Object.entries(sizes).filter(
      ([, [size]]) => Number.parseFloat(size) * 16 < 12,
    );
    expect(named.map(([name]) => name).sort()).toEqual(["2xs", "3xs"]);
    for (const [name, [size]] of named) {
      const px = Number.parseFloat(size) * 16;
      const literal = floor.get(`.text-\\[${px}px\\]`);
      expect(literal).toBeDefined();
      expect(floor.get(`.text-${name}`)).toBe(literal);
    }
  });
});

describe("global focus style", () => {
  it("outlines every keyboard-focused element in the ring colour", () => {
    const rule = block(CSS, ":focus-visible");
    expect(rule).toMatch(/outline:\s*2px solid hsl\(var\(--ring\)\);/);
    // Base layer, so primitives' own `focus-visible:` utilities still win.
    const base = CSS.lastIndexOf(
      "@layer base {",
      CSS.indexOf(":focus-visible {"),
    );
    expect(block(CSS, "@layer base", base)).toContain(":focus-visible {");
  });
});

describe("off-DOM renderers use the palette", () => {
  /** Renderers that cannot read CSS variables. Each must import its colours
   *  from lib/design/palette.ts instead of hard-coding hex. */
  const FILES = [
    "app/api/share/today/og/route.tsx",
    "app/api/release/og/route.tsx",
    "components/macro/ReportPdfDocument.tsx",
    "lib/email/templates.ts",
    "app/global-error.tsx",
    "app/manifest.ts",
    "app/layout.tsx",
  ];

  for (const file of FILES) {
    it(`${file} has no hard-coded hex colours`, () => {
      // Comments may cite issue numbers ("React #418"); only code counts.
      const code = read(file).replace(/\/\*[\s\S]*?\*\/|(?<!:)\/\/[^\n]*/g, "");
      const literals = code.match(/(?<![&\w])#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi);
      expect(literals ?? []).toEqual([]);
    });
  }

  it("the print block has no hard-coded hex colours", () => {
    const print = block(CSS, "@media print");
    expect(print.match(/#[0-9a-f]{3,6}\b/gi) ?? []).toEqual([]);
  });

  it("public/offline.html carries the palette (it cannot import it)", () => {
    const html = read("public/offline.html");
    const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
    const light = block(style, ":root");
    const dark = block(
      block(style, "@media (prefers-color-scheme: dark)"),
      ":root",
    );
    const themeColors = new Map(
      [
        ...html.matchAll(
          /<meta\s+name="theme-color"\s+media="\(prefers-color-scheme: (light|dark)\)"\s+content="([^"]+)"/g,
        ),
      ].map((m) => [m[1], m[2]]),
    );
    for (const [body, theme] of [
      [light, "light"],
      [dark, "dark"],
    ] as const) {
      // Prettier lower-cases hex in CSS; colours compare case-insensitively.
      const vars = declarations(body.toLowerCase());
      const p = PALETTE[theme];
      expect(vars.get("bg")).toBe(p.background.toLowerCase());
      expect(vars.get("fg")).toBe(p.foreground.toLowerCase());
      expect(vars.get("muted")).toBe(p.mutedForeground.toLowerCase());
      expect(vars.get("border")).toBe(p.border.toLowerCase());
      expect(themeColors.get(theme)?.toLowerCase()).toBe(
        THEME_COLOR[theme].toLowerCase(),
      );
    }
  });

  it("the PWA manifest uses the dark ground", () => {
    const m = manifest();
    expect(m.background_color).toBe(PALETTE.dark.background);
    expect(m.theme_color).toBe(PALETTE.dark.background);
  });
});

describe("tint", () => {
  it("composites a colour over a ground as opaque hex", () => {
    expect(tint("#FFFFFF", 0.04, "#07070A")).toBe(PALETTE.dark.card);
    expect(tint("#8B5CF6", 0, "#07070A")).toBe("#07070A");
    expect(tint("#8B5CF6", 1, "#07070A")).toBe("#8B5CF6");
  });

  it("rejects malformed input instead of producing NaN colours", () => {
    expect(() => tint("#FFF", 0.5, "#000000")).toThrow(/#RRGGBB/);
    expect(() => tint("#FFFFFF", 1.5, "#000000")).toThrow(RangeError);
    expect(() => tint("#FFFFFF", Number.NaN, "#000000")).toThrow(RangeError);
  });
});
