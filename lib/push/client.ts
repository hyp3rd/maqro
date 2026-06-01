"use client";

import { clientFetch } from "@/lib/auth/client-fetch";

/** Browser-side helpers for the Web Push subscribe / unsubscribe
 *  flow. All functions are no-ops on the server (every callsite
 *  guards with `typeof window`) and on environments without the
 *  Notification / PushManager APIs (which most desktops support but
 *  iOS Safari restricts to installed PWAs). */

/** Browsers expose the VAPID public key as a Uint8Array, not the
 *  base64url string we fetch from the server. This converter
 *  handles the url-safe variant + padding. */
export function urlBase64ToUint8Array(base64UrlString: string): Uint8Array {
  const padding = "=".repeat((4 - (base64UrlString.length % 4)) % 4);
  const base64 = (base64UrlString + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Is Web Push usable on this browser, right now? Three things must
 *  be true:
 *    - Service Worker support (almost universal but Safari needed an
 *      installed PWA until 16.4)
 *    - PushManager on the window (still missing on some embedded
 *      browsers - Tinder's in-app Chrome shim, etc.)
 *    - Notification permission API
 *  We don't check for VAPID config here - that's a server detail
 *  the UI fetches via /api/push/vapid-key. */
export function isPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Current permission state. Mirrors the Notification API plus a
 *  fourth case for unsupported browsers so the UI can render an
 *  "unsupported" message rather than the generic "default" toggle. */
export type PushPermission = "granted" | "denied" | "default" | "unsupported";

export function getPermission(): PushPermission {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission as PushPermission;
}

/** Subscribe this browser to push and POST the subscription to the
 *  server. Returns true on success, false on any failure (caller
 *  toasts an appropriate error).
 *
 *  Flow:
 *    1. Fetch the VAPID public key from the server.
 *    2. Get the active service worker registration.
 *    3. Ask the browser for permission (if not already granted).
 *    4. Subscribe via PushManager - produces { endpoint, keys }.
 *    5. POST to /api/push/subscribe.
 *
 *  A subscription is idempotent on the browser side; calling this
 *  again with an existing subscription just re-POSTs the same
 *  endpoint, which the server upserts. */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!isPushSupported()) {
    return {
      ok: false,
      reason: "Push notifications aren't supported on this browser.",
    };
  }

  // 1. VAPID key.
  const keyRes = await fetch("/api/push/vapid-key");
  if (!keyRes.ok) {
    return {
      ok: false,
      reason: "Push notifications aren't configured on this deployment.",
    };
  }
  const { publicKey } = (await keyRes.json()) as { publicKey?: string };
  if (!publicKey) {
    return { ok: false, reason: "Missing VAPID key from server." };
  }

  // 2. Service worker - we registered it in ServiceWorkerProvider; if
  //    no registration is ready yet, push isn't ready either.
  const registration = await navigator.serviceWorker.ready;

  // 3. Permission. `Notification.requestPermission` returns the
  //    current value if already decided, so this is safe on repeat
  //    calls.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: "Notification permission was denied." };
  }

  // 4. Subscribe (or pick up an existing subscription).
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // The DOM lib's `applicationServerKey` is typed as
      // `BufferSource` (ArrayBuffer-backed), but TS 5.x widened
      // Uint8Array's `buffer` to `ArrayBufferLike` which includes
      // SharedArrayBuffer. The runtime is fine with our plain
      // Uint8Array; the `.buffer as ArrayBuffer` cast narrows back
      // to what the DOM signature expects.
      applicationServerKey: urlBase64ToUint8Array(publicKey)
        .buffer as ArrayBuffer,
    });
  }

  // 5. POST to server. The subscription object's toJSON() produces
  //    exactly the shape the API expects.
  const json = subscription.toJSON();
  const res = await clientFetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      userAgent: navigator.userAgent,
    }),
  });
  if (!res.ok) {
    return { ok: false, reason: "Server rejected the subscription." };
  }
  return { ok: true };
}

/** Tear down push on this browser. Two-step: unsubscribe from the
 *  PushManager (the provider stops routing) and delete our server
 *  row (the cron stops queueing). Errors in either step are
 *  best-effort - the user toggled off; the worst case is one
 *  orphaned record that the next 410 will reap. */
export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  const endpoint = subscription?.endpoint;
  if (subscription) {
    try {
      await subscription.unsubscribe();
    } catch {
      // Provider error - keep going so we still delete the server row.
    }
  }
  await clientFetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(endpoint ? { endpoint } : {}),
  }).catch(() => {
    // Network error - the cron will eventually 410 and prune.
  });
}
