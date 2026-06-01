import { withBotId } from "botid/next/config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import bundleAnalyzer from "@next/bundle-analyzer";

/** next-intl wires server + client locale messages via a Webpack /
 *  Turbopack plugin. The plugin reads `i18n/request.ts` per request
 *  and makes `useTranslations()` / `getTranslations()` available to
 *  every component. Single-locale today; adding a second locale
 *  later doesn't touch this file. */
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** Bundle analyzer wraps the Next config when `ANALYZE=true`.
 *  Triggered via `npm run analyze` which sets the env and runs
 *  the normal build — afterwards two HTML reports drop into
 *  `.next/analyze/`. Off by default so CI / normal dev builds
 *  don't pay the (small) instrumentation cost. */
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

/** Baseline security headers applied to every route.
 *
 *  Each header earns its slot. The grouping below mirrors OWASP's
 *  "Secure Headers" project recommendations, adapted for the actual
 *  surface area this app exposes (no third-party iframes, no payment
 *  card data in-page, Stripe redirects only).
 *
 *  CSP notes:
 *
 *    - `'unsafe-inline'` in `script-src` and `style-src` is the
 *      reluctant pragmatic choice. Next.js's App Router inlines a
 *      small per-page hydration script, and Tailwind v4 inlines a
 *      handful of style blocks. Eliminating both requires nonce-based
 *      CSP with middleware on every request — a separate, larger
 *      change. This baseline still blocks the most common XSS shape
 *      (loading a script from an attacker-controlled origin); the
 *      stricter nonce-based version is tracked as a follow-up.
 *
 *    - Dev-only relaxations (see `IS_DEV` below): React 19 uses
 *      `eval()` in development to reconstruct cross-environment
 *      stack traces and Turbopack HMR sets up a WebSocket on the
 *      same origin. Both need `'unsafe-eval'` and `ws:` to be in
 *      the CSP; both are stripped in production where they'd be a
 *      real risk. React explicitly does not use `eval()` in prod
 *      builds, and Turbopack HMR doesn't run there.
 *
 *    - We do NOT allowlist Stripe in `script-src` because the app
 *      uses Stripe's redirect flow (Checkout + Customer Portal) via
 *      `window.location.assign(url)`. Top-level navigation is not
 *      subject to CSP, so no Stripe origins need to appear here.
 *
 *    - `connect-src` lists every host the browser actually opens an
 *      XHR/fetch/WebSocket to: Supabase REST + WebSocket realtime,
 *      and nothing else. All API calls to Anthropic, Stripe, Resend,
 *      OpenFoodFacts go server-to-server, so they don't appear here.
 *      Vercel analytics endpoints were removed when Speed Insights
 *      was dropped to honor the "no analytics" privacy promise.
 *
 *    - `frame-ancestors 'none'` is the modern replacement for
 *      `X-Frame-Options: DENY`. We send both because older clients
 *      (and some scanners) still grade on the legacy header.
 *
 *    - `upgrade-insecure-requests` is a no-op in prod (everything is
 *      already HTTPS) and harmless in dev (localhost is exempted by
 *      the spec). */
/** `next dev` and `next build` both load this config, so we can
 *  read NODE_ENV at config-eval time. In dev, NODE_ENV is
 *  `development`; in `next start` (prod runtime) it's `production`. */
const IS_DEV = process.env.NODE_ENV !== "production";

const CSP_DIRECTIVES = [
  "default-src 'self'",
  // `'unsafe-eval'` is only added in dev for React 19's
  // stack-reconstruction path. Production builds keep the stricter
  // policy that blocks `eval` outright.
  `script-src 'self' 'unsafe-inline'${IS_DEV ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // `https://*.maqro.app` covers Maqro-owned subdomains (preview
  // deploys, staging, any future CDN host) so images served from
  // those origins clear CSP. Wildcard matches a single label, so
  // `https://www.maqro.app` and `https://preview-xxxx.maqro.app`
  // pass; the apex `https://maqro.app` is already covered by
  // `'self'` when served from that origin.
  "img-src 'self' blob: data: https://*.supabase.co https://*.maqro.app",
  "font-src 'self' data:",
  // `ws:` (insecure WebSocket) is added in dev for Turbopack HMR
  // over localhost. Prod uses secure WebSockets only.
  // `https://*.maqro.app` covers fetch / XHR to Maqro-owned
  // subdomains (preview deploys, staging, future API subdomains);
  // `wss://*.maqro.app` is the WebSocket twin — Supabase realtime
  // runs on a custom subdomain (`wss://s.maqro.app/realtime/v1/...`)
  // and would otherwise be blocked because CSP treats `wss://` as
  // a distinct scheme from `https://`.
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.maqro.app wss://*.maqro.app${IS_DEV ? " ws:" : ""}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "upgrade-insecure-requests",
].join("; ");

/** Permissions-Policy: explicit allowlist for browser capabilities.
 *  Anything not listed defaults to the spec's default (usually `self`).
 *
 *    - `camera=(self)` — needed by `/api/identify-meal` (food photo).
 *    - `payment=()` — we don't use the Payment Request API; Stripe
 *      Checkout runs on its own origin.
 *    - `geolocation=(self)` — the "Find stores near me" feature reads
 *      the device location (on an explicit tap) to look up nearby
 *      grocery stores. Same-origin only; third parties stay blocked.
 *
 *  The full list is intentional, not noise — every entry documents an
 *  invariant ("we do not call this API"). */
/** Modern Chrome / Edge / Safari reject unknown directives loudly
 *  (a `console.error` per page load), so this list is intentionally
 *  trimmed to features that are actually in the current
 *  Permissions-Policy spec. Dropped from earlier drafts:
 *    - `ambient-light-sensor` — never reached cross-browser support
 *    - `battery` — deprecated as a fingerprinting vector */
const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=(self)",
  "camera=(self)",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=(self)",
  "gamepad=()",
  "geolocation=(self)",
  "gyroscope=()",
  "hid=()",
  "idle-detection=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "picture-in-picture=()",
  // WebAuthn: `signInWithPasskey()` / `registerPasskey()` call
  // `navigator.credentials.get()` / `.create()`, which these two
  // directives gate. `(self)` allows our own top-level origin and
  // nothing else. Today's browsers don't enforce these for top-level
  // same-origin WebAuthn (passkeys work even with `()`), but `()`
  // literally means "deny", so `(self)` removes the latent risk of a
  // future browser tightening enforcement and breaking passkey login.
  "publickey-credentials-get=(self)",
  "publickey-credentials-create=(self)",
  "screen-wake-lock=()",
  "serial=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

const SECURITY_HEADERS = [
  // 2-year HSTS with subdomains. We do not include `preload` —
  // submitting to hstspreload.org is a one-way commitment that's
  // hard to back out of; opt in only after the production domain
  // has been stable for months.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  // Modern clickjacking protection lives in CSP's `frame-ancestors`.
  // X-Frame-Options is sent for legacy parity (some scanners still
  // grade on it, and IE/old WebKit ignore CSP for framing).
  { key: "X-Frame-Options", value: "DENY" },
  // Block MIME-sniffing so a misdetected upload can't be coerced
  // into running as a script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Send only the origin on cross-origin navigations — avoids
  // leaking full URLs (including query params and short-lived
  // tokens) to third parties when users click out.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  // Isolate the browsing context so cross-origin popups can't grab a
  // window handle and probe the page's globals (Spectre-class).
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Content-Security-Policy", value: CSP_DIRECTIVES },
];

const nextConfig: NextConfig = {
  // Emit source maps for the production client bundle so a minified
  // stack (e.g. the recurring React #418 hydration mismatch, whose
  // frames are all mangled React internals) resolves to real source
  // locations in browser devtools and in our error_log. There's no
  // exposure cost here: this app is open-source (Apache-2.0, public on
  // GitHub), so the `.map` files reveal nothing that isn't already
  // published. Keeping it on is fine; flip to `false` only if build
  // size or build time ever becomes a concern.
  productionBrowserSourceMaps: false,
  // Add `crossorigin="anonymous"` to the <script> + <link> tags Next
  // generates. Without it, the browser masks any error thrown from a
  // script it considers cross-origin as a bare "Script error." with no
  // filename, line, or stack — which is exactly the useless shape the
  // error_log was filling up with (iOS Safari is especially
  // aggressive here, and it also matters the moment assets ever move
  // behind a CDN/edge origin). With the attribute set, `window.onerror`
  // receives the real error details, so the admin Errors view becomes
  // actionable. Same-origin assets already send the headers this needs.
  crossOrigin: "anonymous",
  async headers() {
    return [
      {
        // Apply the baseline security headers to every route. Per-
        // path overrides below add caching directives but don't
        // need to repeat these (Next.js merges per-source header
        // lists rather than overwriting).
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        // The service-worker script itself must never be cached
        // by browsers or CDNs — a stale SW will continue serving
        // stale assets to users indefinitely, with no way to
        // recover short of clearing site data. `no-cache` forces
        // revalidation on every load; bytes only transfer when
        // the SW has actually changed.
        //
        // `Service-Worker-Allowed: /` lets the SW control the
        // whole origin even though it's served from /sw.js. The
        // header is redundant when scope === script directory,
        // but explicit is safer if we ever move it.
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
        ],
      },
      {
        // The offline fallback should never be served stale. It's
        // tiny so the revalidation cost is negligible.
        source: "/offline.html",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
    ];
  },
};

export default withBotId(withBundleAnalyzer(withNextIntl(nextConfig)));
