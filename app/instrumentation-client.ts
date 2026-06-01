import { initBotId } from "botid/client/core";

/** Vercel BotID client init.
 *
 *  The `protect` list tells BotID which fetches to attach challenge
 *  headers to. The server side enforces it via `checkBotId()` —
 *  without the matching client entry, the server check fails and
 *  legitimate traffic is blocked. Both sides must agree on `method`
 *  and `checkLevel`.
 *
 *  Scope: deep-analysis only. We previously gated a wider set of
 *  routes (AI calls, backup-email lifecycle, push-subscribe, billing
 *  portal) at the basic-tier `checkLevel`, but production data
 *  showed BotID's basic classifier consistently flagged Arc browser
 *  + installed PWA sessions as bot — a meaningful slice of real
 *  users. Those routes already have abuse caps that don't depend on
 *  bot detection (per-user AI quota, pending-state singleton on
 *  backup-email, RLS on push subscriptions); BotID was producing
 *  noise without security. Now we only protect the four routes
 *  where false negatives are truly irrecoverable: money movement,
 *  destructive admin actions, and account-takeover surfaces.
 *
 *  What's NOT in this list (and shouldn't be):
 *
 *    - `/api/billing/webhook` — Stripe is the caller, not a browser.
 *    - `/api/cron/*` — Vercel cron is the caller.
 *    - `/api/health` — uptime monitors are the caller.
 *    - `/api/errors` — defensive error reporting; bot-gating breaks
 *      the very loop we'd need to detect a bot attack.
 *    - `/login` — OTP submission talks to supabase.co directly
 *      (cross-origin); BotID can't see those headers.
 *    - AI routes, backup-email, push-subscribe, billing portal —
 *      basic-tier was removed as described above.
 *
 *  See https://vercel.com/docs/botid/get-started
 *  and https://vercel.com/docs/botid/advanced-configuration. */
initBotId({
  protect: [
    {
      path: "/api/billing/checkout",
      method: "POST",
      advancedOptions: { checkLevel: "deepAnalysis" },
    },
    {
      path: "/api/delete-account",
      method: "POST",
      advancedOptions: { checkLevel: "deepAnalysis" },
    },
    {
      // BotID wildcards match path segments, so this captures every
      // event id in `/api/admin/webhooks/<evt_…>/replay`.
      path: "/api/admin/webhooks/*/replay",
      method: "POST",
      advancedOptions: { checkLevel: "deepAnalysis" },
    },
    {
      // Lost-email recovery: emails a one-shot sign-in link to a
      // verified backup address. Deep-analysis because successful
      // abuse here equates to account takeover.
      path: "/api/auth/recovery",
      method: "POST",
      advancedOptions: { checkLevel: "deepAnalysis" },
    },
  ],
});
