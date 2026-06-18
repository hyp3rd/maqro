# Configuration

All env vars in one place. Anything unset gracefully disables the
feature it backs - the app stays runnable on a bare-minimum config.

## Required for auth, sync, billing, admin, email

| Variable                               | Purpose                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project URL                                                                 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-safe publishable / anon key                                                  |
| `SUPABASE_SECRET_KEY`                  | Service-role key (server-only). Used by delete-account, cron, webhooks, admin routes |

## Optional

| Variable                           | Backs                                                                                | Default behavior when unset                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`              | Canonical deployment URL (emails, OG meta)                                           | Falls back to `VERCEL_URL` or `http://localhost:3000`             |
| `ANTHROPIC_API_KEY`                | AI meal-plan / recipe-gen / meal-identify                                            | AI buttons fall back / hide                                       |
| `STRIPE_SECRET_KEY`                | Server-side Stripe client                                                            | Checkout / portal / webhook 503                                   |
| `STRIPE_WEBHOOK_SECRET`            | Webhook signature verification                                                       | Webhook 503                                                       |
| `STRIPE_PRICE_AI_PLUS_MONTHLY`     | Stripe Price ID for AI Plus monthly                                                  | Plus monthly checkout 503                                         |
| `STRIPE_PRICE_AI_PLUS_YEARLY`      | Stripe Price ID for AI Plus yearly                                                   | Plus yearly checkout 503                                          |
| `STRIPE_PRICE_PRO_MONTHLY`         | Stripe Price ID for Pro monthly                                                      | Pro monthly checkout 503                                          |
| `STRIPE_PRICE_PRO_YEARLY`          | Stripe Price ID for Pro yearly                                                       | Pro yearly checkout 503                                           |
| `RESEND_API_KEY`                   | Transactional email send                                                             | Welcome / reminder / recap / trial-ending skip                    |
| `EMAIL_FROM`                       | `From:` address for Resend                                                           | Same                                                              |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`     | Browser push subscription key                                                        | Push toggle hidden in Settings                                    |
| `VAPID_PRIVATE_KEY`                | Server-side push send signing                                                        | Push cron sends are no-ops                                        |
| `VAPID_SUBJECT`                    | `mailto:` / URL the push providers contact                                           | Push cron sends are no-ops                                        |
| `CRON_SECRET`                      | Auth for `/api/cron/*` (Vercel cron header)                                          | Cron routes 503                                                   |
| `ERROR_LOG_DISABLED=1`             | Kill-switch for the server-side ingest                                               | Errors logged                                                     |
| `NEXT_PUBLIC_ERROR_LOG_DISABLED=1` | Kill-switch for the client reporter                                                  | Errors reported                                                   |
| `UPSTASH_REDIS_REST_URL`           | Cross-instance Open Food Facts cache (REST URL)                                      | OFF lookups fetch directly (no cross-instance cache)              |
| `UPSTASH_REDIS_REST_TOKEN`         | Cross-instance Open Food Facts cache (REST token)                                    | Same                                                              |
| `AUTH_REFRESH_CACHE_SECRET`        | Encrypts the proxy session refresh-lock (needs `UPSTASH_*`) — stops deploy sign-outs | Lock inert; each request refreshes on its own (the sign-out race) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`   | Cloudflare Turnstile widget on the public email-sending forms (needs the secret)     | No bot challenge (BotID + rate limits still apply)                |
| `TURNSTILE_SECRET_KEY`             | Server-side Turnstile token verification (fail-closed; needs the site key)           | Same                                                              |

> The OFF cache is optional and **fail-open** — set both `UPSTASH_REDIS_REST_*`
> (Vercel Marketplace → Upstash Redis, same region as the deploy) to make a cold
> serverless instance as fast as a warm one; unset, every barcode/search lookup
> just falls back to a direct fetch.

## Supabase setup (auth + sync)

1. Create a project at <https://supabase.com> (free tier is enough).
1. **Project Settings → API Keys**: copy the **Project URL** + the
   **publishable key** (`sb_publishable_…` or legacy `anon`).
1. Paste them into `.env.local`:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
   SUPABASE_SECRET_KEY=sb_secret_…
   ```

1. **Apply schema migrations** with the
   [Supabase CLI](https://supabase.com/docs/guides/cli) — install it separately
   (e.g. `brew install supabase/tap/supabase`):

   ```bash
   supabase login                          # browser OAuth, one-time
   supabase link --project-ref <your-ref>  # find ref in dashboard URL
   npm run db:push                         # alias for `supabase db push`
   ```

   Runs every file in [`supabase/migrations/`](../supabase/migrations/)
   that hasn't been applied yet. Other db scripts:

   | Command             | What it does                            |
   | ------------------- | --------------------------------------- |
   | `npm run db:status` | List which migrations have been applied |
   | `npm run db:pull`   | Pull remote schema into a new migration |
   | `npm run db:new`    | Scaffold a new migration file           |

   For automated migrations on merge to `main`, see
   [`.github/workflows/supabase-migrations.yml`](../.github/workflows/supabase-migrations.yml).

1. **Authentication → URL Configuration**: set the **Site URL** to
   your test domain and add `/auth/callback` to **Redirect URLs**.
1. **Customize the magic-link email** (Authentication → Email
   Templates → Magic Link AND Change Email Address) to include the
   OTP code:

   ```html
   <h2>Your sign-in code</h2>
   <p>Enter this code in the app:</p>
   <p style="font-size: 1.6em; font-family: monospace; letter-spacing: 0.3em;">
     <strong>{{ .Token }}</strong>
   </p>
   <p>Or click the link: <a href="{{ .ConfirmationURL }}">Sign in</a></p>
   ```

1. Restart `npm run dev`. The sidebar should show "Sign in" instead
   of "Guest".

## AI (Claude) setup - optional

Several routes use Anthropic; all are opt-in by `ANTHROPIC_API_KEY`
(absent → the buttons hide / fall back) and metered against the
monthly AI cap:

- **`/api/meal-plan`** - Sonnet 4.6 multi-turn agent loop with
  programmatic coherence validation (rejects single-fat meals,
  multi-fish dinners, etc.) and a retry loop that surfaces complaints
  back to the model. Falls back to the deterministic solver.
- **`/api/recipes/generate`** - Haiku 4.5 generates one recipe
  (4–10 ingredients) honoring diet / cuisine / allergy settings.
- **`/api/identify-meal`** - Sonnet 4.6 vision: photo → structured
  macros, used by the camera identification flow.
- **`/api/identify-pantry`** - vision: fridge/shelf photo → pantry
  items to review and add.
- **`/api/voice-log`** - Haiku 4.5 parses a spoken meal ("200g
  chicken and a banana") into structured foods.
- **`/api/shopping/suggest`** - turns pantry gaps into an
  aisle-grouped restock list (deterministic fallback when AI is off).
- **`/api/meal-insights`** - Haiku 4.5 "suggestions for next time"
  for one meal (Pro-gated). The deterministic balance check works
  offline; this is the optional richer layer.

The food/recipe routes share the same hardening: catalog-bounded
names (macros computed server-side from catalog × portion, never
invented), prompt caching, in-loop validation feedback, OFF-search
fallback with timeout, forced-submit on the final iteration.

```env
ANTHROPIC_API_KEY=sk-ant-…
```

Set a usage budget while you're there - a single Auto-fill costs
≪$0.001 with prompt-cache hits, but a budget is cheap insurance.

## Billing (Stripe) setup - optional

Two paid tiers:

| Tier        | Monthly | Yearly | AI generations / mo | Sync | Cloud export | Engagement email |
| ----------- | ------- | ------ | ------------------- | ---- | ------------ | ---------------- |
| **Free**    | -       | -      | 25                  | -    | -            | -                |
| **AI Plus** | €5      | €48    | 500                 | -    | -            | ✓                |
| **Pro**     | €12     | €120   | unlimited           | ✓    | ✓            | ✓                |

In addition to sync / cloud export / engagement email, **micronutrient
tracking** and **per-meal AI suggestions** are Pro-only; free and Plus
users see an upgrade prompt in their place.

Existing users at launch are auto-grandfathered to Pro for 12 months
(see [migration 0017](../supabase/migrations/0017_tiered_billing.sql)).

1. Create a Stripe account, create one Product per tier with monthly
   and yearly Prices, copy the Price IDs into `.env.local`.
1. Set up the webhook endpoint in Stripe Dashboard → Developers →
   Webhooks pointing at `https://<your-domain>/api/billing/webhook`.
   Subscribe to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

   Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

1. Configure the Stripe Customer Portal (Dashboard → Settings →
   Billing → Customer portal): allow cancel, update payment method,
   download invoices. The "Manage subscription" button in Settings →
   Billing redirects users here.
1. **Enable Stripe Tax** (Dashboard → More → Tax → Get started) if
   you're selling to the EU / UK / any jurisdiction that requires
   VAT / GST / sales-tax collection. The Checkout Session is
   already configured with `automatic_tax: { enabled: true }`,
   `tax_id_collection: { enabled: true }`, and the mandatory
   `customer_update: { name: "auto", address: "auto" }` block so
   B2B buyers can supply a VAT ID and get reverse-charge invoices
   automatically. **Stripe Tax requires you to register tax
   obligations in destination countries** - Stripe will surface
   warnings in the dashboard until your registrations match where
   you're selling. Without those registrations the engine still
   runs but flags your invoices.

The webhook handler is idempotent (event IDs persist in
`stripe_webhook_events`), signature-verified, and re-fetches the
authoritative subscription state from Stripe so partial event
payloads can't corrupt the profile row.

**API-version note**: we pin the SDK's `apiVersion` to
`2026-04-22.dahlia` in [`lib/billing/stripe.ts`](../lib/billing/stripe.ts).
That version moved `current_period_end` off the top-level
`Subscription` and onto each subscription item - our webhook
reads it from `subscription.items.data[0].current_period_end`. If
you bump the pin, re-verify against Stripe's API changelog: any
similar field relocations need the corresponding handler update.

## Transactional email (Resend) setup - optional

Drives four flows:

- **Welcome** when a user opts in to email notifications (idempotent,
  guarded by `notification_preferences.welcome_sent_at`)
- **Daily reminder** at the user's local reminder hour for users who
  haven't logged a meal today (hourly cron + per-row local-time gate,
  includes streak count)
- **Weekly recap** Monday 08:00 UTC with last 7 days' macro averages,
  on-target-days count, and weight delta
- **Trial ending** 24–48h before a Stripe trial converts to paid,
  with a portal link so the user can cancel before the charge.
  Idempotent via `profiles.trial_ending_email_sent_at`.

1. Get a Resend API key from <https://resend.com>. Verify your
   sending domain.
1. Add to `.env.local`:

   ```env
   RESEND_API_KEY=re_…
   EMAIL_FROM=Maqro <hello@yourdomain.com>
   ```

1. For production, configure Vercel Cron via
   [`vercel.json`](../vercel.json) and set `CRON_SECRET` in Vercel +
   the Vercel Cron header. The cron routes refuse unauthenticated
   calls.

## Browser push notifications - optional

VAPID-signed Web Push delivers the daily reminder as a system
notification alongside (or instead of) the email channel. Three env
vars, generated once:

1. **Generate a VAPID key pair**:

   ```bash
   npx web-push generate-vapid-keys
   ```

   Outputs a public key (87 chars, base64url) and a private key.

1. Add to `.env.local`:

   ```env
   NEXT_PUBLIC_VAPID_PUBLIC_KEY=BLm…  # the public half - shipped to the client
   VAPID_PRIVATE_KEY=…                 # server-only, signs the JWT each push provider verifies
   VAPID_SUBJECT=mailto:you@example.com  # contact the push providers escalate to
   ```

   `VAPID_SUBJECT` can be a `mailto:` or `https://` URL - Google /
   Mozilla / Apple's push services use it to reach you if your
   traffic looks abusive. A real address you read beats a noreply.

1. Restart the dev server. Settings → Email notifications now shows
   a **Browser push** toggle below the email channels. Enabling it
   triggers the OS permission prompt; granting it subscribes the
   current browser via `PushManager.subscribe` and stores the
   subscription in `public.push_subscriptions`. The daily-reminder
   cron fans out to every subscription the user has + their email
   channel; each successful 410 prunes dead subscriptions
   automatically.

The push payload deep-links into `/app?view=plan`; tapping focuses
the existing tab if one is open, otherwise opens a new window.

## Admin dashboard - optional

Sets you up to manage users, override AI usage caps, and view the
audit log via `/admin`. Requires:

1. Migrations 0012 (role) and 0018 (audit log) applied.
1. Promote yourself to admin by hand the first time, via Supabase
   Studio's SQL editor:

   ```sql
   update public.profiles
   set role = 'admin'
   where user_id = '<your-uuid-from-auth.users>';
   ```

1. Re-load `/admin`. The Sidebar now shows an Admin link below the
   nav for admins only. Subsequent admin grants happen through the
   dashboard's user list (every action audit-logged).

---

[← Documentation index](./README.md) · [Project README](../README.md)
