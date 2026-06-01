import { ImageResponse } from "next/og";

/** Programmatic PWA install icon. Next.js's file-based icon
 *  convention auto-links this into the document `<head>` and serves
 *  it at `/icon` — the same URL the manifest references for both
 *  `purpose: "any"` and `purpose: "maskable"`.
 *
 *  Why a generated PNG instead of more SVG entries: Chrome / Edge
 *  on desktop accept SVG manifest icons, but iOS Safari's
 *  Add-to-Home-Screen and older Android installers refuse them
 *  silently and fall through to the generic globe glyph. That's the
 *  bug this file fixes — the PWA was installing without an app icon
 *  because the manifest had no PNG fallback.
 *
 *  The mark is inset to ~60% of the canvas so Android's maskable
 *  crop (up to 20% per edge) never clips it. Light glyph on the
 *  brand background (#0a0a0c) matches the public/logo-mark-inverse
 *  asset and the in-app dark theme. */
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a0c",
      }}
    >
      <svg
        width="307"
        height="355"
        viewBox="0 0 64 74"
      >
        <rect
          x="10"
          y="14"
          width="8"
          height="56"
          fill="#fafafa"
        />
        <rect
          x="42"
          y="14"
          width="8"
          height="42"
          fill="#fafafa"
        />
        <rect
          x="10"
          y="48"
          width="40"
          height="8"
          fill="#fafafa"
        />
        <circle
          cx="58"
          cy="10"
          r="3"
          fill="#fafafa"
        />
      </svg>
    </div>,
    { ...size },
  );
}
