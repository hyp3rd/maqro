/* eslint-disable */
// @ts-nocheck
//
// Maqro service worker.
//
// Strategy:
//   - Navigations (HTML)   → network-first w/ 3s timeout, fallback to
//                             the offline shell so the app remains
//                             usable when the network is down.
//   - /_next/static/*      → cache-first, immutable (filenames are
//                             content-hashed by Next, so stale ≡ safe).
//   - /api/*               → network-only, never cached. Stale data
//                             is worse than no data.
//   - Everything else      → stale-while-revalidate (icons, manifest,
//                             root /favicon, /public assets).
//
// Update lifecycle:
//   We do NOT call skipWaiting() during install. A new SW is left in
//   the "waiting" state until the client explicitly tells us to take
//   over (postMessage `SKIP_WAITING`). This is on purpose — auto-
//   activating mid-session would refresh the controlling SW while
//   the user has pending IndexedDB writes from the sync engine, and
//   we'd risk losing those writes. The UpdateBanner gates the
//   takeover behind a Refresh click instead.

// Bump the version whenever the SW logic changes — older caches get
// reaped in `activate` and clients get prompted to reload via the
// UpdateBanner. v2 added the push-event POST in notificationclick /
// notificationclose so the admin Engagement tile can compute CTR.
const VERSION = "v2";
const SHELL_CACHE = `maqro-shell-${VERSION}`;
const STATIC_CACHE = `maqro-static-${VERSION}`;
const RUNTIME_CACHE = `maqro-runtime-${VERSION}`;
const OFFLINE_URL = "/offline.html";

// Pre-cached on install. Keep this list small — every entry is
// fetched at install time and a single failure aborts the install.
// Hashed JS/CSS are picked up lazily by the static-asset handler.
const SHELL_ASSETS = [OFFLINE_URL, "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL_ASSETS);
      // Intentionally NOT calling self.skipWaiting() — see header.
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Reap old caches from previous SW versions to keep storage
      // from growing unbounded across deploys.
      const keys = await caches.keys();
      const expected = new Set([SHELL_CACHE, STATIC_CACHE, RUNTIME_CACHE]);
      await Promise.all(
        keys.filter((k) => !expected.has(k)).map((k) => caches.delete(k)),
      );
      // Claim open clients so this SW starts handling fetches
      // immediately — without claim, the page that triggered the
      // install keeps using the previous SW until next reload.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  // The page tells us to activate the waiting SW. Triggered by the
  // user clicking Refresh in the UpdateBanner.
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ─── Web Push ────────────────────────────────────────────────────────
//
// Receive a JSON payload from our server (encrypted with the client's
// p256dh + auth keys; the SDK decrypts before this fires) and render
// it as a system notification.
//
// Payload shape:
//   { title, body, url?, tag? }
//
// `tag` collapses duplicate notifications so a re-fired daily
// reminder doesn't queue up multiple bubbles in the system tray.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Some providers send empty pushes ("you have new data") with no
    // payload. Fall back to a generic notification rather than
    // dropping the event silently.
    data = { title: "Maqro", body: "You have a new notification." };
  }
  const title = data.title || "Maqro";
  const tag = data.tag || "maqro-default";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag,
    // Carry the tag inside `data` too so the notificationclick /
    // notificationclose handlers can read it and POST engagement
    // events keyed to the originating campaign. The top-level
    // `tag` field is used by the OS for collapsing duplicates;
    // `data.tag` is what we round-trip to the server.
    data: { url: data.url || "/app", tag },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Fire-and-forget POST to /api/push/events. Lives in the SW so it
// runs even when no app tab is open. Errors are swallowed —
// engagement telemetry is best-effort and must never block the
// notification close / navigation logic. Same-origin fetch, so the
// user's auth cookies tag in automatically; the route reads
// `auth.uid()` from the cookie session.
function logPushEvent(eventType, tag) {
  return fetch("/api/push/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // `keepalive` lets the request finish even after the SW idles —
    // important because notificationclick may navigate the user
    // immediately after the click handler returns.
    keepalive: true,
    body: JSON.stringify({ event: eventType, tag: tag || null }),
  }).catch(() => {});
}

// On click: focus an existing tab if we have one, otherwise open a
// fresh one at the payload's URL. Matching by origin (not exact
// path) so a user on /app/foods doesn't get a second tab opened at
// /app — we focus what they already have and trust the in-app
// navigation to take it from there.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = data.url || "/app";
  const tag = data.tag || null;
  event.waitUntil(
    (async () => {
      // Engagement ping first — keepalive lets it survive the focus/
      // navigate that follows. We don't await it before navigating
      // because the user shouldn't wait on telemetry to land on the
      // page.
      logPushEvent("click", tag);

      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const origin = self.location.origin;
      for (const client of allClients) {
        if (client.url.startsWith(origin) && "focus" in client) {
          await client.focus();
          // Best-effort: navigate to the target URL after focus.
          // Some browsers (Safari) restrict client.navigate, hence
          // the try/catch.
          try {
            if ("navigate" in client) await client.navigate(targetUrl);
          } catch {}
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});

// notificationclose fires when the user dismisses without clicking.
// Useful for computing "engagement" beyond raw click-through:
// a high close-rate with no clicks means the copy isn't compelling.
// Not all browsers fire it reliably (iOS Safari PWAs in particular),
// so the close count is a lower bound on mobile.
self.addEventListener("notificationclose", (event) => {
  const data = event.notification.data || {};
  event.waitUntil(logPushEvent("close", data.tag || null));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only GETs are cacheable. POST/PUT/DELETE pass straight through.
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Cross-origin requests (OpenFoodFacts, Anthropic, Supabase, etc.)
  // pass through untouched — we don't want to inadvertently cache
  // a third-party response with our cache keys.
  if (url.origin !== self.location.origin) return;

  // API routes — strict network-only. Stale API data would mislead
  // the user (e.g. AI usage cap, version check, share status).
  if (url.pathname.startsWith("/api/")) return;

  // Navigations — HTML requests for routes.
  if (req.mode === "navigate") {
    event.respondWith(handleNavigate(req));
    return;
  }

  // Static Next.js assets — content-hashed, safe to cache forever.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Everything else (icons, manifest, fonts, /public/*) —
  // stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
});

async function handleNavigate(req) {
  try {
    // Race the network against a 3s timeout. The timeout matters on
    // flaky mobile connections — better to serve the offline page
    // than spin for 30s on a hung TCP connection.
    const networkResponse = await Promise.race([
      fetch(req),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
    return networkResponse;
  } catch {
    // Network failed or timed out — serve the precached offline
    // shell. Returns a 200 with our static HTML rather than the
    // browser's "no internet" page.
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(OFFLINE_URL);
    if (cached) return cached;
    // Last-resort fallback if even the offline page isn't cached.
    return new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const response = await fetch(req);
    // Only cache successful, basic-type responses. Opaque /
    // partial responses (206) cause weird cache-hit behavior.
    if (response.ok && response.type === "basic") {
      cache.put(req, response.clone());
    }
    return response;
  } catch (err) {
    // Static asset miss + offline → propagate. The page will show
    // whatever degraded state it can.
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  // Kick off a background revalidation regardless of cache hit.
  const networkPromise = fetch(req)
    .then((response) => {
      if (response.ok && response.type === "basic") {
        cache.put(req, response.clone());
      }
      return response;
    })
    .catch(() => null);
  // If we have a cached copy, serve immediately and let the
  // revalidation update the cache for next time. Otherwise wait
  // for the network.
  return cached || (await networkPromise) || Response.error();
}
