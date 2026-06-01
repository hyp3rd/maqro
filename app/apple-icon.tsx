import { ImageResponse } from "next/og";

/** Programmatic iOS apple-touch-icon at 180×180. Next.js's file
 *  convention serves it at `/apple-icon` and auto-emits the
 *  `<link rel="apple-touch-icon">` tag — iOS Safari's
 *  Add-to-Home-Screen reads that tag, not the manifest.
 *
 *  iOS doesn't crop the icon (no maskable safe-zone concern), so
 *  the mark fills more of the canvas (~70%) than the Android-side
 *  [icon.tsx](./icon.tsx). The home-screen rounded-rectangle mask
 *  is applied by the OS at install time. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
        width="128"
        height="148"
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
