import webpush, { type PushSubscription, type WebPushError } from "web-push";
import { getVapidConfig } from "./config";

/** Result of attempting to send a single push. The `gone` flag tells
 *  the caller to delete the corresponding row — the push provider
 *  returned 404/410 meaning the subscription has been revoked
 *  (browser uninstalled, permissions revoked, etc.) and continuing
 *  to push to it just wastes a request per send. */
export type PushSendResult =
  | { ok: true; status: number }
  | { ok: false; gone: true; status: number; error: string }
  | { ok: false; gone: false; status: number | null; error: string };

/** Shape of a subscription row as the daily-reminder cron reads it
 *  from `public.push_subscriptions`. Compatible with the
 *  `PushSubscription` type the `web-push` library expects (it takes
 *  endpoint + keys). */
export type SubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

let configured = false;

/** Lazy one-time configure for the web-push module. The library
 *  stores VAPID details in module-global state — subsequent calls
 *  are cheap. Returns false when VAPID env is missing so the caller
 *  can skip the send and avoid throwing a confusing
 *  "No VAPID details provided" deep in the library. */
function ensureConfigured(): boolean {
  if (configured) return true;
  const cfg = getVapidConfig();
  if (!cfg) return false;
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  configured = true;
  return true;
}

/** Notification payload shape. Kept tight on purpose: every field
 *  here ends up in a Notification ad-hoc, which means more is more
 *  noise. The service worker reads this JSON and feeds it to
 *  `self.registration.showNotification`. */
export type PushPayload = {
  title: string;
  /** Body text. Kept brief — push UI on most platforms truncates
   *  past one line. */
  body: string;
  /** Deep link. The service worker's `notificationclick` handler
   *  focuses an existing tab or opens this URL. Relative paths are
   *  resolved against the app origin. */
  url?: string;
  /** Tag — letting multiple sends collapse into one visible
   *  notification (the user doesn't want a queue of daily-reminder
   *  bubbles if the cron ever double-fires). */
  tag?: string;
};

/** Send a single push notification. Wraps `web-push.sendNotification`
 *  with a JSON-stringified payload and a TTL the providers will
 *  respect. */
export async function sendPush(
  sub: SubscriptionInput,
  payload: PushPayload,
): Promise<PushSendResult> {
  if (!ensureConfigured()) {
    return {
      ok: false,
      gone: false,
      status: null,
      error: "VAPID not configured",
    };
  }

  const pushSub: PushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };

  try {
    const result = await webpush.sendNotification(
      pushSub,
      JSON.stringify(payload),
      {
        // TTL = how long the push provider holds the message for an
        // offline device. 24h is the right ceiling for a "log your
        // dinner" nudge — older than that, the reminder is stale
        // and counterproductive.
        TTL: 24 * 60 * 60,
        // High urgency. The provider may batch low-urgency pushes;
        // we want immediate delivery for a daily reminder.
        urgency: "normal",
      },
    );
    return { ok: true, status: result.statusCode };
  } catch (err) {
    const webPushErr = err as WebPushError;
    const status =
      typeof webPushErr.statusCode === "number" ? webPushErr.statusCode : null;
    const errorMsg =
      webPushErr.body ||
      (err instanceof Error ? err.message : "Push send failed");
    // 404 / 410 = subscription is gone. The caller should delete
    // its row. Any other status (5xx, 401, 403) is a transient or
    // configuration error — keep the row around for the next retry.
    if (status === 404 || status === 410) {
      return { ok: false, gone: true, status, error: errorMsg };
    }
    return { ok: false, gone: false, status, error: errorMsg };
  }
}
