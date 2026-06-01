# Security Policy

Thank you for taking the time to make Maqro safer.

This document covers how to report a vulnerability, what we promise
in return, and a short threat model so you understand which surfaces
matter most.

## Reporting a vulnerability

Open a **private security advisory** on GitHub:

→ <https://github.com/hyp3rd/macro-calculator/security/advisories/new>

That keeps the report off the public issue tracker until we've had a
chance to triage and patch.

If you can't use GitHub advisories for any reason, email the
maintainer at the address in the GitHub profile. Encrypt with the
PGP key on the same profile if the report contains exploit details.

**Please do not:**

- File a public GitHub issue with reproduction steps.
- Post to Twitter, Mastodon, Reddit, or any other public channel
  before we've published a fix or 90 days have passed (whichever
  comes first).
- Test against any deployment other than your own local instance.
  Even read-only probes against shared infrastructure are out of
  scope without an explicit prior agreement.

## What we ask in a report

Include enough for us to reproduce the issue. Concretely:

- A short description of the vulnerability and its impact.
- A minimal proof-of-concept (a request, a snippet, a screenshot).
- The branch / commit SHA / deployed version you tested against
  (the footer chip in the app, or `package.json#version`).
- Your environment: browser version, OS, anything quirky.
- An email or handle we can use to credit you in the advisory if
  you'd like that. We respect "remain anonymous" too.

If the issue is theoretical (a class of bug rather than a concrete
exploit), say so. We still want to hear about it, but the response
SLA below applies to demonstrable issues.

## What we promise

| Stage                                  | Target time          |
| -------------------------------------- | -------------------- |
| Acknowledge receipt                    | within 72 hours      |
| Initial triage + impact assessment     | within 7 days        |
| Patch in a release branch              | within 30 days       |
| Public advisory + credit (if accepted) | when the patch ships |

If the fix takes longer than 30 days because it's structurally hard,
we'll keep you posted with a written update every 14 days until the
patch is out.

We don't run a paid bug-bounty program. We do publish credit in the
GitHub security advisory and the release notes when the reporter
agrees.

## Threat model — what we worry about

Maqro is a personal nutrition app with two operating modes (guest /
signed-in). The surfaces that matter most:

1. **Cross-user data leak.** Every Supabase table is RLS-scoped to
   the row owner. Anything that lets one signed-in user read or
   write another user's row is a critical issue.
1. **Privilege escalation.** Promoting yourself (or any other user)
   to `role = 'admin'` without going through the audit-logged
   `/api/admin/users/[id]/role` route is critical. The admin
   dashboard and every `/api/admin/*` route must check
   `requireAdmin()` server-side.
1. **Stripe webhook spoofing.** The webhook handler verifies the
   `Stripe-Signature` header against `STRIPE_WEBHOOK_SECRET`. Any
   path that bypasses that check (forged event, signature stripping,
   replay) is critical — it would let attackers grant themselves
   paid status.
1. **Webhook replay / idempotency bypass.** Every Stripe event ID is
   recorded in `stripe_webhook_events`; duplicates short-circuit.
   Defects that let a replayed event re-trigger billing state
   changes are high-impact.
1. **AI cost-cap bypass.** The `checkAndIncrementAiUsage` gate runs
   _server-side_ in every AI route. A path that lets a free user
   bypass the metering counter and burn unlimited Anthropic budget
   is high-impact (operational, not a data leak, but a real concern
   for the maintainer's cost line).
1. **Error-log PII leak.** Logs intentionally exclude email, user
   ID, and IP. Any code path that lets identifying data into the
   `error_log` table is a privacy issue. The `sanitizeContext`
   filter in `lib/error-reporter.ts` is the defense; reports of it
   failing are welcome.
1. **Session cookie handling.** Supabase's HTTP-only session cookie
   is refreshed by `proxy.ts`. Anything that exposes it to JS, lets
   a CSRF token through, or skips refresh on a stale session is a
   real issue.
1. **Shared-recipe enumeration.** Public-share URLs at `/r/[slug]`
   use a high-entropy slug (`lib/share-slug.ts`). If you can guess
   another user's `members-only` or `disabled` recipe without their
   slug, that's a vulnerability.

## Out of scope

These categories are either by-design or low-impact for this app:

- **Self-XSS via Devtools / paste-in-console** — Chrome warns users
  about it; we don't need to.
- **Open redirect to user-controlled URLs** outside of `auth/*`. We
  validate auth redirects against the configured Supabase Redirect
  URLs; everything else is a static link.
- **Clickjacking on logged-out pages** (`/`, `/login`, `/terms`,
  `/privacy`, `/r/[slug]`). They render the same content to anyone
  and have no logged-in actions to hijack.
- **Missing security headers we haven't set** (e.g. CSP). We're
  open to PRs adding them, but their absence isn't a vulnerability.
- **Rate limiting** at the application layer beyond what's already
  in `/api/errors`. Vercel's edge handles most of this; targeted
  abuse should be reported but isn't a vuln per se.
- **Vulnerabilities in third-party services** (Supabase, Stripe,
  Anthropic, Resend, Open Food Facts). Report those to the
  respective vendors.
- **Issues that require physical access** to an unlocked,
  unsupervised device.
- **Social engineering** of the maintainer or other users.

## Disclosure practice

When we ship a fix, we publish a GitHub Security Advisory with:

- A CVE if one applies (we'll request it from MITRE/GitHub if not
  pre-assigned).
- A CVSS v3.1 score for severity.
- A clear description of the issue, the fix, and what users need to
  do (upgrade? rotate secrets? re-deploy?).
- Credit to the reporter if they want it.

For high-severity issues we'll also pin a notice in the README until
most deployments have upgraded.

## Hardening already in place

For context — these are the controls a report should assume are
present, so you can focus on what's actually unique:

- **Row-Level Security** on every Postgres table. Policies are in
  `supabase/migrations/`.
- **Service-role key never reaches the browser**. Used only in
  server routes (`/api/admin/*`, `/api/billing/webhook`,
  `/api/cron/*`, `/api/delete-account`, etc.).
- **Stripe webhook signature verification** using the SDK's
  `constructEvent`, plus DB-backed event-ID idempotency.
- **`requireAdmin()` server guard** on every `/api/admin/*` route
  and on the `/admin` page tree.
- **Cron auth** via `CRON_SECRET` bearer header.
- **CSRF resistance**: Supabase uses HTTP-only cookies with
  SameSite=Lax, and state-changing routes are JSON POSTs (not
  form-encoded) which browsers don't auto-submit cross-origin.
- **No user input in SQL strings** — every query goes through
  Supabase's parameterized PostgREST client or `from(...).eq(...)`.
- **Output escaping** is React's default; we don't use
  `dangerouslySetInnerHTML` anywhere in the rendered surface.
- **Device session list + remote disconnect**. Users can list every
  signed-in browser from Settings → Signed-in devices and disconnect
  remote sessions. A 12-hour grace from the calling device's first
  sign-in prevents a freshly-compromised session from immediately
  locking out the legitimate user. Revocation invalidates the
  underlying `auth.sessions` + `auth.refresh_tokens` rows via a
  `SECURITY DEFINER` RPC restricted to `service_role`; the kicked
  browser also wipes its local IndexedDB via a Realtime listener
  on its own `user_devices` row so a stolen cookie can't outlive
  the disconnect.
- **Reset device** in Settings wipes IndexedDB + localStorage on
  this device and signs out, without touching the Supabase account.
  Useful for handing the device to someone else, recovering from a
  corrupted local cache, or undoing a `?demo=1` sample-data session.
- **Web Push subscription endpoints** (`p256dh` + `auth` keys) live
  in `public.push_subscriptions` with owner-only RLS. The keys are
  consumed only server-side by the `web-push` library (which
  performs the elliptic-curve payload encryption); they're never
  exposed to any other client. Failed sends with a 404/410 from the
  push provider auto-prune the row so dead endpoints don't
  accumulate.

Thanks again for keeping Maqro safer.
