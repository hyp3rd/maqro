import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
const config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // CSS-variable names are wired up in `app/layout.tsx` via
        // next/font's `variable:` option. The fallback chain matters
        // when the web font hasn't loaded yet (FOUT window) and when
        // the user's network drops the font request entirely — pick
        // system fonts that match the metrics of the primary font as
        // closely as possible to minimize layout shift.
        sans: [
          "var(--font-sans)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        display: [
          "var(--font-display)",
          "var(--font-sans)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      // Every colour token in app/globals.css is mapped here (enforced by
      // lib/design/palette.test.ts). Values are `hsl(var(--x))` over HSL
      // channel triples, so opacity modifiers (`bg-brand/10`) work.
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        // `destructive` is destructive-red text; `destructive-strong` is the
        // fill behind a `destructive-foreground` label.
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          strong: "hsl(var(--destructive-strong))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        // Tertiary text tier (captions, units, timestamps): `text-faint-foreground`.
        faint: { foreground: "hsl(var(--faint-foreground))" },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        // `brand` is the graphic accent; `brand-strong` is the fill behind a
        // `brand-foreground` label; `brand-text` is brand-coloured text.
        brand: {
          DEFAULT: "hsl(var(--brand))",
          foreground: "hsl(var(--brand-foreground))",
          strong: "hsl(var(--brand-strong))",
          text: "hsl(var(--brand-text))",
        },
        // "Now / open / today" marks only.
        signal: {
          DEFAULT: "hsl(var(--signal))",
          foreground: "hsl(var(--signal-foreground))",
        },
        // Fills (`bg-macro-protein`) and text-safe variants
        // (`text-macro-protein-text`).
        macro: {
          protein: {
            DEFAULT: "hsl(var(--macro-protein))",
            text: "hsl(var(--macro-protein-text))",
          },
          carbs: {
            DEFAULT: "hsl(var(--macro-carbs))",
            text: "hsl(var(--macro-carbs-text))",
          },
          fat: {
            DEFAULT: "hsl(var(--macro-fat))",
            text: "hsl(var(--macro-fat-text))",
          },
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        teal: {
          50: "#f0fdfa",
          100: "#ccfbf1",
          200: "#99f6e4",
          300: "#5eead4",
          400: "#2dd4bf",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
          900: "#134e4a",
          950: "#042f2e",
        },
        rose: {
          50: "#fff1f2",
          100: "#ffe4e6",
          200: "#fecdd3",
          300: "#fda4af",
          400: "#fb7185",
          500: "#f43f5e",
          600: "#e11d48",
          700: "#be123c",
          800: "#9f1239",
          900: "#881337",
          950: "#4c0519",
        },
      },
      // One scale off `--radius` (12px): bare `rounded` 4px for marks and
      // chips, `sm` 6px, `md` 10px for controls, `lg` 12px for panels,
      // `xl`/`2xl` 16/20px for hero cards and sheets.
      borderRadius: {
        DEFAULT: "calc(var(--radius) - 8px)",
        sm: "calc(var(--radius) - 6px)",
        md: "calc(var(--radius) - 2px)",
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 8px)",
      },
      // Pointer-aware control sizes: `h-touch-9` is `h-9` on a fine pointer
      // and at least 44px (`--touch-target-min`, app/globals.css) on a
      // coarse one. One class per dimension, so a call site's plain `h-7`
      // replaces it outright through cn() (lib/utils.ts registers these).
      spacing: {
        "touch-7": "max(1.75rem, var(--touch-target-min))",
        "touch-8": "max(2rem, var(--touch-target-min))",
        "touch-9": "max(2.25rem, var(--touch-target-min))",
        "touch-10": "max(2.5rem, var(--touch-target-min))",
      },
      // Named small sizes replacing literal `text-[10px]` / `text-[11px]`,
      // plus `label` (13px) for readable sentence-case labels. The coarse-
      // pointer readability floor in app/globals.css matches 3xs/2xs too.
      fontSize: {
        "3xs": ["0.625rem", { lineHeight: "0.875rem" }],
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
        label: ["0.8125rem", { lineHeight: "1.125rem" }],
      },
      keyframes: {
        "accordion-down": {
          from: { height: 0 },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: 0 },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
