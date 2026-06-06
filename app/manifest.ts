import type { MetadataRoute } from "next";

/** Web app manifest. Next.js renders this at `/manifest.webmanifest`
 *  and links it from the `<head>` automatically — no need to add a
 *  `<link rel="manifest">` to the layout. Required for Chrome /
 *  Edge / Android's `beforeinstallprompt` flow.
 *
 *  iOS Safari doesn't use the manifest for "Add to Home Screen" —
 *  it reads the `apple-touch-icon` link tag + `appleWebApp` meta
 *  already defined in [layout.tsx](./layout.tsx) instead. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Maqro Calculator",
    short_name: "Maqro",
    description:
      "Private macro calculator, meal planner, and progress tracker.",
    // PWA opens straight into the app, not the marketing landing
    // at `/`. Installed users have already decided to use the
    // product; bouncing them through the landing would be silly.
    start_url: "/app",
    // Stable identity so app updates aren't seen as a new install, and a
    // root scope so in-app navigation stays in the standalone window
    // (start_url /app sits inside it).
    id: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0c",
    theme_color: "#0a0a0c",
    orientation: "portrait",
    icons: [
      // Static PNGs in `public/` — the reliable install path. These replace
      // the old dynamic `/icon` route (app/icon.tsx, an Edge ImageResponse)
      // that installers fetched directly and which 404'd on some installs,
      // leaving a generic glyph. The 512 doubles as the maskable icon — the
      // glyph is inset to ~60% of the canvas, inside the safe zone.
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      // SVG fallback for installers that prefer vector. Kept last so the PNGs
      // win by default on platforms that accept both.
      {
        src: "/logo-mark.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
    categories: ["health", "fitness", "lifestyle"],
  };
}
