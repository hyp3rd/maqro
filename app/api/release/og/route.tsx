import { CHANGELOG } from "@/lib/changelog";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

/** Branded 1080×1080 "what's new" release card for Instagram, generated on the
 *  Edge from `?id=<changelogId>`. It renders the REAL changelog entry (title +
 *  version), so there is nothing to spoof and no signing is needed — the title
 *  is already public. The Instagram Graph API fetches this URL as the post's
 *  image; the admin dashboard previews it inline.
 *
 *  Brand + technique mirror app/api/share/today/og/route.tsx (Satori, hex
 *  colours, the mark rebuilt from positioned divs). */
export const runtime = "edge";

const SIZE = 1080;

const COLORS = {
  bg: "#0a0a0c",
  fg: "#fafafa",
  fgDim: "#52525b",
  border: "#2a2535",
  brand: "#a78bfa",
  brandSoft: "#1b1530",
};

export async function GET(req: NextRequest): Promise<Response> {
  const id = req.nextUrl.searchParams.get("id");
  const entry = CHANGELOG.find((e) => e.id === id) ?? CHANGELOG[0];
  if (!entry) {
    return new Response("No changelog entry.", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const title = entry.title;
  const titleSize = title.length > 70 ? 56 : title.length > 45 ? 66 : 80;

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: COLORS.bg,
        padding: 88,
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: COLORS.fg,
        letterSpacing: "-0.01em",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <BrandMark />
          <span
            style={{
              fontSize: 34,
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
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: "0.24em",
            color: COLORS.brand,
            textTransform: "uppercase",
          }}
        >
          What&apos;s new
        </span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
          gap: 30,
        }}
      >
        {entry.version && (
          <div style={{ display: "flex" }}>
            <span
              style={{
                display: "flex",
                fontSize: 26,
                fontWeight: 600,
                color: COLORS.brand,
                background: COLORS.brandSoft,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 9999,
                padding: "10px 24px",
              }}
            >
              v{entry.version}
            </span>
          </div>
        )}
        <span
          style={{
            display: "flex",
            fontSize: titleSize,
            fontWeight: 800,
            lineHeight: 1.08,
            letterSpacing: "-0.02em",
            color: COLORS.fg,
          }}
        >
          {title}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 22, color: COLORS.fgDim }}>
          Private, offline-first nutrition tracking.
        </span>
        <span style={{ fontSize: 24, fontWeight: 600, color: COLORS.fg }}>
          maqro.app
        </span>
      </div>
    </div>,
    {
      width: SIZE,
      height: SIZE,
      headers: {
        "Cache-Control": "public, s-maxage=3600, immutable",
        "Content-Type": "image/png",
      },
    },
  );
}

/** The Maqro mark rebuilt from positioned divs (Satori's <svg> is patchy),
 *  scaled from the 64×74 public/logo-mark.svg viewBox. */
function BrandMark() {
  const scale = 46 / 64;
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: 64 * scale,
        height: 74 * scale,
      }}
    >
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
          background: COLORS.brand,
        }}
      />
    </div>
  );
}
