# Deployment & operations

Deploying Maqro on Vercel + Supabase, and the operational gotchas worth knowing.

## Deployment

The main app is a standard Next.js 16 deploy on Vercel; no special
build step. Things that have bitten this repo and aren't obvious:

- **`NEXT_PUBLIC_*` env vars are inlined at build time.** Add or
  change one in Vercel and you must **redeploy with the build cache
  disabled** for the new values to land in the client bundle.
  Symptom: deployed `/login` says "Supabase isn't configured".
- **Tick env vars for the Production environment.** Custom domains
  serve Production; a var that's only on Preview won't reach `*.app`.
- **Supabase URL configuration is strict-matched.** Every domain you
  serve from needs Site URL + Redirect URL entries (`/auth/callback`,
  `/auth/confirm`).
- **Webhook URL** must point at the Production deployment, and the
  signing secret must match. Use Stripe's "Send test webhook"
  feature to verify before pointing real traffic at it.
- **Cron secret** must match between Vercel's env vars and the
  scheduled job header. Vercel injects the header automatically when
  the job's URL matches a route configured in `vercel.json`.

## Operational notes

- **PWA registration** is production-only. A dev-mode service worker
  caches Turbopack HMR chunks and makes "why isn't my change
  showing?" debugging unnecessarily painful. The version checker
  (poll `/api/version` every 10 minutes + on visibility change) and
  the SW's `updatefound` listener both feed the same UpdateBanner -
  whichever fires first shows the Refresh prompt.
- **Error logs** capture stack trace, page, app version, user-agent,
  and a session-rotated random token only. No email, no user_id, no
  IP. The session token rotates per browser session via
  `sessionStorage` so errors from the same tab correlate but never
  link to a specific user.
- **Hydration mismatches (React #418/#423/#425)** are captured with a
  before-hydration `MutationObserver` that records the literal
  server→client diff (`lib/hydration-dom-watch.ts`), since prod React
  strips the component stack. Many are **not app bugs**: a DOM-mutating
  browser extension (password managers such as ProtonPass/1Password
  inject an element into `<body>`) or a page translator rewrites the
  HTML before React hydrates. Those are fingerprinted
  (`lib/hydration-environment.ts`), flagged `externallyCaused`, and
  logged at `warning` rather than `error` — visible for triage but not
  treated as actionable. They cannot be fixed app-side (React's own
  #418 docs call this out), so they are **parked by design**.
- **Sampling** protects the table from a single client emitting the
  same report thousands of times (a render loop, or a mismatch a user
  keeps reloading into): identical reports — keyed by level + route +
  message — are logged in full for the first few occurrences, then
  down-sampled to ≈1% (`lib/error-sampling.ts`), counted per tab
  session in `sessionStorage`.
- **Cron security**: Vercel cron hits the routes with a
  `Bearer ${CRON_SECRET}` header; the routes reject anything else
  with 401. All cron routes (daily-reminder, weekly-recap,
  trial-ending, retention) are idempotent - either via a same-day
  stamp on `notification_preferences.last_reminder_sent_date` or
  `profiles.trial_ending_email_sent_at`, or via a "skip if logged"
  content check.
- **Health endpoint**: `GET /api/health` returns
  `{ ok, version, time, checks: { supabase, stripe } }` for uptime
  monitors (Better Uptime, UptimeRobot, Vercel deployment gates).
  HTTP 200 when Supabase is reachable, 503 otherwise. Stripe
  reachability is reported but non-critical to the overall status.
- **Device sessions**: every sign-in is registered in
  `public.user_devices` (keyed on the Supabase access token's
  `session_id` claim) so users can list and remotely disconnect
  signed-in browsers from Settings. The "disconnect another device"
  path enforces a 12-hour grace from the calling device's first
  sign-in - protects a legitimate user from a freshly-compromised
  session that tries to lock them out. Revocation calls a
  `SECURITY DEFINER` RPC that deletes the matching rows from
  `auth.sessions` and `auth.refresh_tokens`; the kicked browser
  learns via a Realtime `DELETE` event on its own row, then wipes
  IDB and signs out.
- **Webhook idempotency**: every Stripe event ID is persisted to
  `stripe_webhook_events` before any state change. Duplicates
  short-circuit. We also re-fetch the authoritative subscription
  from Stripe in the handler rather than trusting embedded payloads.
- **Admin actions** all write to `admin_audit_log` with the
  before/after payload. Reads + writes go through the service-role
  client; RLS denies anyone else.

---

[← Documentation index](./README.md) · [Project README](../README.md)
