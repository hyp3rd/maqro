import { parseShareBadgeParams } from "@/lib/share-badge";
import { isSigningEnabled, verifyShareBadge } from "@/lib/share-badge-signing";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

/** Branded social card for "Share today". A 1200×630 PNG
 *  (Twitter / Facebook / iMessage / Slack standard) generated on
 *  the Edge from query params. The contract for params lives in
 *  [lib/share-badge.ts](../../../../../lib/share-badge.ts) — that
 *  module owns parsing AND URL construction so the two ends can't
 *  drift.
 *
 *  Why a server-rendered PNG instead of a client canvas:
 *    - One canonical render. iOS Safari, Android Chrome, and
 *      Firefox don't agree on canvas font kerning or emoji glyphs;
 *      a server render is byte-identical across recipients.
 *    - The PNG is shareable as a *file* via Web Share API, so the
 *      receiver gets an image (Instagram Stories, WhatsApp,
 *      iMessage) instead of an unfurled link.
 *    - The same URL is forward-compatible with an OG meta-tag
 *      strategy later (point a `/share/today/<id>` page at this
 *      route as its og:image and Twitter will unfurl a card).
 *
 *  Caching: the image is a pure function of the params, so a long
 *  edge cache is safe. We use `s-maxage=3600, immutable` — a fresh
 *  share is cheap (a few KB of PNG), and the params include
 *  current macro values which change as soon as the user logs more
 *  food, so the same URL rarely repeats anyway. */
export const runtime = "edge";

const WIDTH = 1200;
const HEIGHT = 630;

// Brand palette — matches the app's `.dark` CSS custom properties
// in [app/globals.css](../../../../../app/globals.css). Inlined as
// literal hex because Satori's HSL handling is unreliable for
// gradient/border combinations and the dark surface is the single
// most important visual: getting the background tone wrong reads
// as "this isn't a Maqro card".
const COLORS = {
  bg: "#0a0a0c",
  surface: "#101013",
  border: "#27272a",
  fg: "#fafafa",
  fgMuted: "#a1a1aa",
  fgDim: "#52525b",
  protein: "#5BB8E5",
  carbs: "#F4B040",
  fat: "#E0739D",
  rail: "#1f1f23",
};

export async function GET(req: NextRequest): Promise<Response> {
  const numbers = parseShareBadgeParams(req.nextUrl.searchParams);

  // When `SHARE_BADGE_SECRET` is set, the route REQUIRES a valid
  // HMAC. Reject unsigned or tampered requests with 403 — never
  // render a Maqro-branded card from URL data we can't attest to.
  // When the secret isn't set (dev / self-hosted), `verifyShareBadge`
  // returns true vacuously and we render whatever was asked for.
  if (isSigningEnabled()) {
    const sig = req.nextUrl.searchParams.get("sig") ?? "";
    const ok = await verifyShareBadge(numbers, sig);
    if (!ok) {
      return new Response("Invalid or missing signature.", {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }
  }

  const kcalPct = pct(numbers.caloriesCurrent, numbers.caloriesTarget);

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: COLORS.bg,
        padding: "56px 64px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: COLORS.fg,
        letterSpacing: "-0.01em",
      }}
    >
      <Header />
      <HeroCalories
        current={numbers.caloriesCurrent}
        target={numbers.caloriesTarget}
        pct={kcalPct}
      />
      <MacroRows
        protein={[numbers.proteinCurrent, numbers.proteinTarget]}
        carbs={[numbers.carbsCurrent, numbers.carbsTarget]}
        fat={[numbers.fatCurrent, numbers.fatTarget]}
      />
      <Footer />
    </div>,
    {
      width: WIDTH,
      height: HEIGHT,
      headers: {
        "Cache-Control": "public, s-maxage=3600, immutable",
        // Hint to the share button that this is intentionally an
        // image response — if the route ever 500s, the button's
        // `res.ok` check trips instead of mis-treating an HTML
        // error page as a PNG blob.
        "Content-Type": "image/png",
      },
    },
  );
}

function Header() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <BrandMark />
        <span
          style={{
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: "0.32em",
            color: COLORS.fg,
          }}
        >
          MAQRO
        </span>
      </div>
      <span
        style={{
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: "0.2em",
          color: COLORS.fgMuted,
          textTransform: "uppercase",
        }}
      >
        Today
      </span>
    </div>
  );
}

/** The Maqro mark rebuilt from positioned `<div>`s. Satori's `<svg>`
 *  support is patchy across primitives, so we draw the three bars
 *  + dot directly. Coordinates derive from the canonical SVG in
 *  [public/logo-mark.svg](../../../../../public/logo-mark.svg)
 *  scaled to ~52px tall. */
function BrandMark() {
  // Native SVG viewBox is 64×74. Rendered at 44×51 here.
  const scale = 44 / 64;
  const w = 64 * scale;
  const h = 74 * scale;
  return (
    <div style={{ display: "flex", position: "relative", width: w, height: h }}>
      <div
        style={{
          position: "absolute",
          left: 10 * scale,
          top: 14 * scale,
          width: 8 * scale,
          height: 56 * scale,
          background: COLORS.fg,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 42 * scale,
          top: 14 * scale,
          width: 8 * scale,
          height: 42 * scale,
          background: COLORS.fg,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 10 * scale,
          top: 48 * scale,
          width: 40 * scale,
          height: 8 * scale,
          background: COLORS.fg,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: (58 - 3) * scale,
          top: (10 - 3) * scale,
          width: 6 * scale,
          height: 6 * scale,
          borderRadius: "9999px",
          background: COLORS.fg,
        }}
      />
    </div>
  );
}

function HeroCalories({
  current,
  target,
  pct,
}: {
  current: number;
  target: number;
  pct: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        marginTop: 40,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
        <span
          style={{
            fontSize: 144,
            fontWeight: 800,
            lineHeight: 1,
            color: COLORS.fg,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {current.toLocaleString()}
        </span>
        {target > 0 && (
          <span
            style={{
              fontSize: 40,
              fontWeight: 500,
              color: COLORS.fgMuted,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            / {target.toLocaleString()} kcal
          </span>
        )}
        {target === 0 && (
          <span
            style={{ fontSize: 40, fontWeight: 500, color: COLORS.fgMuted }}
          >
            kcal
          </span>
        )}
      </div>
      {target > 0 && (
        <Bar
          pct={pct}
          colour={COLORS.fg}
          height={6}
        />
      )}
    </div>
  );
}

function MacroRows({
  protein,
  carbs,
  fat,
}: {
  protein: [number, number];
  carbs: [number, number];
  fat: [number, number];
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        marginTop: 44,
      }}
    >
      <MacroRow
        label="Protein"
        current={protein[0]}
        target={protein[1]}
        colour={COLORS.protein}
      />
      <MacroRow
        label="Carbs"
        current={carbs[0]}
        target={carbs[1]}
        colour={COLORS.carbs}
      />
      <MacroRow
        label="Fat"
        current={fat[0]}
        target={fat[1]}
        colour={COLORS.fat}
      />
    </div>
  );
}

function MacroRow({
  label,
  current,
  target,
  colour,
}: {
  label: string;
  current: number;
  target: number;
  colour: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              display: "flex",
              width: 10,
              height: 10,
              borderRadius: "9999px",
              background: colour,
            }}
          />
          <span style={{ fontSize: 22, fontWeight: 600, color: COLORS.fg }}>
            {label}
          </span>
        </div>
        <span
          style={{
            fontSize: 22,
            fontWeight: 500,
            color: COLORS.fgMuted,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {current}g{target > 0 ? ` / ${target}g` : ""}
        </span>
      </div>
      <Bar
        pct={pct(current, target)}
        colour={colour}
        height={4}
      />
    </div>
  );
}

function Bar({
  pct,
  colour,
  height,
}: {
  pct: number;
  colour: string;
  height: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height,
        borderRadius: "9999px",
        background: COLORS.rail,
      }}
    >
      <div
        style={{
          display: "flex",
          width: `${pct}%`,
          height: "100%",
          borderRadius: "9999px",
          background: colour,
        }}
      />
    </div>
  );
}

function Footer() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: "auto",
      }}
    >
      <span
        style={{ fontSize: 16, color: COLORS.fgDim, letterSpacing: "0.04em" }}
      >
        Track macros that match your goal.
      </span>
      <span
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: COLORS.fg,
          letterSpacing: "0.04em",
        }}
      >
        maqro.app
      </span>
    </div>
  );
}

function pct(current: number, target: number): number {
  if (target <= 0) return 0;
  const raw = (current / target) * 100;
  if (raw < 0) return 0;
  if (raw > 100) return 100;
  return raw;
}
