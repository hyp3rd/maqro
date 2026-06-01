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
    display: "standalone",
    background_color: "#0a0a0c",
    theme_color: "#0a0a0c",
    orientation: "portrait",
    icons: [
      // PNG entries first — these are what every install path
      // actually picks up. The SVG-only manifest worked for desktop
      // Chrome / Edge but iOS Safari's Add-to-Home-Screen and older
      // Android installers refused it silently and showed a generic
      // globe glyph in the installed shortcut. The 512×512 PNG is
      // generated on the Edge by [app/icon.tsx](./icon.tsx) — Next.js
      // serves it at /icon and the same URL serves both `any` and
      // `maskable` purposes because the glyph is inset to ~60% of
      // the canvas, well inside the maskable safe zone.
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      // SVG fallbacks for installers that prefer vector. Chrome /
      // Edge / Firefox / Samsung all accept `image/svg+xml` and
      // rasterize on demand, so a single entry covers any size the
      // OS asks for. Kept after the PNG so the PNG wins by default
      // on platforms that accept both.
      {
        src: "/logo-mark.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/logo-mark.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
    categories: ["health", "fitness", "lifestyle"],
  };
}
