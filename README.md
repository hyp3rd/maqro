# Maqro

[![CodeQL Advanced](https://github.com/hyp3rd/maqro/actions/workflows/codeql.yml/badge.svg)](https://github.com/hyp3rd/maqro/actions/workflows/codeql.yml) [![gitleaks](https://github.com/hyp3rd/maqro/actions/workflows/gitleaks.yml/badge.svg)](https://github.com/hyp3rd/maqro/actions/workflows/gitleaks.yml)

## Join and use it for free at [maqro.app](https://maqro.app)

A personal macro calculator, meal planner, pantry, and weight-tracking
journal.
Next.js app with a Supabase-backed optional account for multi-device
sync - or run it fully local in **guest mode** and everything lives in
your browser's IndexedDB. Installable as a PWA, works offline, and
ships with privacy-respecting operational logging.

![Maqro-Landing](assets/design/landing.png)

**New here?** [Run it locally](./docs/development.md) ·
[Documentation](#documentation) · [Architecture](./docs/architecture.md) ·
[Roadmap](./docs/ROADMAP.md)

## What it does

- **Calculator** - Mifflin–St Jeor BMR, TDEE from activity, target
  calories from a signed weekly weight-change rate (1 kg ≈ 7700 kcal,
  clamped at ±1%/week of bodyweight and floored at `max(BMR, 1200)`).
  Manual TDEE override for calibrating against real-world outcomes.
- **Goal phases (Pro)** - sequence a cut → diet break → maintenance →
  lean bulk and let your calorie + macro target follow whichever phase
  is active today. Applying a phase that would _raise_ today's target
  (e.g. a cut gentler than your current deficit) asks for a quick
  confirm first, so the change is never a surprise.
- **Meal Plan** - log foods against a per-profile set of meal slots
  (Breakfast / Lunch / Dinner / Snacks by default, fully editable in
  the Template editor). Auto-fill a day that hits your macro targets
  via a 3×3 linear solve over a protein/carb/fat triplet; portions
  snap to 5 g. Per-meal regenerate to refresh a single slot without
  blowing away the rest.
- **AI auto-fill (opt-in)** - Claude Sonnet 4.6 generates a coherent
  day (breakfasts that look like breakfasts), then a **programmatic
  coherence validator** rejects standalone-fat meals, multi-fish
  dinners, naked-carb mains, and snack monsters before the plan ever
  hits your screen. Falls back to the deterministic solver on every
  error path. Issues the validator can't get the AI to self-correct
  surface inline as **per-meal warning chips** with a one-tap
  "Regenerate this meal" action; day-level rules (low day protein)
  render as a single banner with a "Try refining" button.
  Plans are **personalized** with a soft bias toward foods you've
  actually been eating (top of the last ~30 days of logs) so the
  generated rotation looks like your rotation.
- **"Don't know what to eat today?"** - one tap asks the AI to build a
  breakfast / lunch / dinner day from **your own saved recipes** that
  lands near your remaining macro targets (what's left after what you've
  already logged). Review the picks, **Shuffle** for another, or **Log
  this day** to drop them all into today's slots — it only picks from
  recipes you've saved, never inventing food.
- **Log a meal (guided)** - on mobile, a step-by-step bottom-sheet:
  pick a meal slot, then pick _how_ — search foods, apply a recipe or
  template, scan a barcode, photograph the plate, or talk — and the
  right full-screen tool opens, pre-targeted to that slot (with a
  "back to method" affordance throughout). Desktop keeps the inline
  Add Food form, with the meal picker as icon tiles. A meal that
  already has food gets a quick **Add food** in its `⋯` menu that jumps
  straight to that slot's recents + search — no need to restart the
  flow. Adding a food flashes its card, scrolls it into view, and (on
  supported devices) gives a light haptic tap; the day header shows
  **calories left** against today's target.
- **Meal insights** - tap any logged meal for a detail sheet: macro
  share + sub-macros, a micronutrient read (Pro), and a deterministic
  **balance check** that flags imbalances ("fat-heavy", "low fiber",
  "high saturated fat / added sugar", "great source of vitamin C") and
  **goal fit** (share of your daily calories, protein adequacy vs your
  target). Optional one-tap **suggestions for next time** (Pro, Claude
  Haiku) behind a one-line "uses a monthly request" consent with a
  remember-my-choice option, plus a not-medical-advice note.
- **Daily logs** - every day's meals are persisted by `YYYY-MM-DD`
  key, with a date navigator to browse history without losing today's
  state.
- **Meal templates** - save any logged meal as a reusable template
  ("Greek yogurt bowl") and apply it to any slot on any day. Full
  template editor lets you rename slots, change defaults, and order
  them.
- **Recipes** - named bundles of ingredients with optional cuisine
  and prep notes, browsed as a **card grid** with a diet badge
  (**Vegan / Vegetarian / Omnivore**, derived from the ingredients)
  and the cuisine at a glance. Build manually, generate via AI (biased
  toward foods from your recent rotation), drag-to-reorder ingredients,
  **share via public URL** (auto-slug or custom for Pro) with `public` /
  `members-only` / `disabled` visibility. Apply a saved recipe to any
  meal slot and the dialog re-orders by per-serving macro fit to that
  slot's share of the day — the top recipe gets a **Best fit** badge
  when there's competition. Open a recipe to send any of its ingredients
  to your **shopping list** in a tap.
- **Meal schedules** - schedule a recipe across a date range + chosen
  weekdays (the "cook once, log for the week" meal-prep flow). Schedules
  are **saved, not written ahead**: they live in a **Scheduled** list in
  Recipes (edit / cancel anytime) and surface on each matching day as a
  one-tap **"Scheduled → Log it"** offer on the empty slot — so the day
  view stays honest to what you actually logged.
- **Weight history + Progress** - log weigh-ins; see a sparkline,
  macro-adherence chart, **streak counter** with **milestone
  celebrations** (3, 7, 14, 30, 60, 100, 180, 365 days), **plateau
  detection** (14-day flat run within ±0.5 kg), and **TDEE
  recalibration** suggestion when your observed weight change
  diverges from expected by more than 50 kcal/day. Charts open
  **fullscreen in landscape** on mobile with **pinch-to-zoom**,
  drag-to-pan, and double-tap reset; desktop expands to a wide modal.
- **Body measurements** - optional waist / neck / hip log with a
  Catmull-Rom smoothed trend chart and a US Navy / Hodgdon–Beckett
  body-fat estimate (metric form). Stored locally and synced to
  Supabase like the rest of the journal data.
- **Blood pressure** - log systolic / diastolic (plus optional pulse
  and a note); each reading is classified by the ACC/AHA categories and
  kept in a history on your Profile, synced like the rest of the journal.
- **Hydration** - a tap-to-add daily water counter against a goal scaled
  to your bodyweight (unit-aware — ml or fl oz), surfaced on the Progress
  card and in your report.
- **Intermittent fasting** - start a fast from the day view and track a
  live countdown to your eating window on a protocol you pick (16:8 /
  18:6 / 20:4 / custom). The Fasting page maps your current fast onto an
  hour-by-hour phase timeline (fed → glycogen → fat-burning → ketosis →
  autophagy, with a not-medical-advice note), and every completed fast
  is saved to a synced history with its duration + phase breakdown.
- **Micronutrients (Pro)** - 10 tracked vitamins / minerals / fiber
  charted against age- and sex-aware daily targets (NIH RDA, FDA Daily
  Value fallback). Values fill in from Open Food Facts as your foods
  are enriched by a background cron, so the panel honestly shows
  partial coverage instead of misleading zeros. Per-nutrient daily
  trend + an average-intake view on Progress, and a per-meal read in
  the meal-detail sheet.
- **Shopping list** - aggregated from the meals you've planned across
  Today / This week / Next 7 days / Last 7 days. On touch, each row
  taps open to a bottom-sheet (quantity / note / send-to-pantry) with
  swipe-to-remove and an **undo** toast. Copy-as-text or open a
  printable PDF report.
- **Pantry** - track what's on hand (name / quantity / unit / aisle /
  density / low-stock threshold), synced across devices, with
  **low-stock notifications**, swipe actions, and a **photo scan**
  (Claude vision) that fills the pantry from a fridge/shelf snapshot.
  Logging a food that matches a pantry item draws it down automatically.
- **Shop for me** - turn the pantry's low/empty items into a clean,
  aisle-grouped restock list. Search per item on Uber Eats / DoorDash /
  Glovo, find **nearby stores** by location or postcode, and save
  **favourite stores**. AI-assisted with a deterministic fallback so it
  always works offline.
- **Food search** - three sources merged into one box:
  - **Built-in** curated catalog
  - **My foods** (IndexedDB, custom entries via manual form, OFF
    search, or camera photo identification)
  - **Open Food Facts** live search via a same-origin proxy
- **Camera meal identification** - point your phone at a label or
  meal. Claude Sonnet 4.6 reads the photo, returns a structured macro
  breakdown, and one tap saves it to My Foods. The camera opens
  full-screen on mobile with a barcode-cutout reticle in scan mode;
  in photo mode, a multi-frame capture samples 6 frames over 1.5s
  and picks the sharpest (Laplacian-variance scoring) for the AI
  pass. Photo-identified meals can be promoted to a recipe directly
  from the review dialog so a recurring plate stops costing one AI
  generation per log.
- **Voice meal logging** (beta) - tap **Talk** on Add Food, dictate
  "200 grams of chicken and a banana", Claude Haiku parses it into
  structured foods you review before adding. Web Speech API where
  available (Chrome / Edge / Safari ≥ 14.5, mobile + desktop);
  textarea fallback on Firefox / Brave.
- **Share today** - tap Share on Daily Totals to push a server-
  rendered branded PNG of your day into iMessage, WhatsApp,
  Instagram Stories, Slack, etc. via Web Share API. Desktop falls
  back through image-clipboard → download. Receivers see a clean
  URL that unfurls into the same card on Twitter / LinkedIn via OG
  meta. Optional HMAC signing (set `SHARE_BADGE_SECRET`) prevents
  hand-crafted URLs from stamping fake numbers under the brand.
- **Reports & backups** - generate a polished report of your nutrition,
  weight, body, blood-pressure, hydration, fasting, and micronutrient
  data as a **vector PDF** you can download or **archive to your private
  cloud storage**. Export a complete backup of everything — optionally
  **end-to-end encrypted** with a passphrase only you hold (zero-
  knowledge) — and restore it from disk or cloud with a
  preview-before-apply diff.
- **Account (optional)** - passwordless email OTP via Supabase.
  Profile, daily logs, weight history, body measurements, custom
  foods, meal templates, recipes, meal schedules, pantry, and
  shopping-list metadata all sync across devices.
- **Sync modes** - a per-device choice (Settings → Sync) for how
  edits reach your account: **Local-first** (stay on this device, save
  manually — with a gentle reminder after a quiet spell of unsaved
  changes), **Auto-save** (push on a 1–30 min interval), or **Always
  sync** (push moments after each change). The topbar shows a clear
  "Save N" button when there are unsaved changes plus a chip for the
  active mode. Stored in `localStorage` (it's device behaviour, not a
  synced setting).
- **Passkeys (optional)** - WebAuthn sign-in via Face ID, Touch ID,
  Windows Hello, or a hardware key. Adding a passkey from
  Settings → Passkeys replaces both the email-code login AND the
  TOTP prompt on that device — the passkey itself is the second
  factor. Backed by Supabase's experimental passkey API; gated on
  the `auth.experimental.passkey` flag in
  [lib/supabase/client.ts](lib/supabase/client.ts).
- **Multi-factor (optional)** - enroll a TOTP authenticator app in
  Settings → Security. AAL2 is enforced both at the proxy (page
  navigations to `/app*` / `/admin*` redirect to the MFA challenge
  if the session is still at AAL1) AND at every authenticated API
  route — the back-button-from-TOTP bypass that affected many
  Supabase-based apps is closed. If a gated action (Auto-fill,
  Generate recipe, Cancel subscription, …) hits the AAL2 gate
  mid-session, an **in-app TOTP prompt** opens, you enter your
  code, and the original action retries automatically — no bounce
  to `/login`. Optional "Trust this device for 7 days" lets you skip
  TOTP from a remembered browser.
- **Backup email (optional)** - secondary recovery address verified
  via a code round-trip. If the primary email is lost (account
  closed, employer-managed inbox revoked) the backup keeps the
  user from getting locked out. Never used for marketing — recovery
  flow only.
- **Touch gestures** - swipe-to-delete + swipe-to-send on shopping
  list and pantry rows; horizontal swipe on the date strip
  advances days in the meal log. Touch-only (gated on
  `pointer: coarse`); desktop keeps the explicit buttons.
- **Mobile-first sheets** - dense desktop grids become clean tap-row →
  bottom-sheet flows on touch (meal log, pantry, shopping list), and
  every destructive action is a consistent bottom-sheet confirmation
  or an undo toast — no stray native `confirm()` dialogs.
- **Multilingual** - English + Italian on the marketing pages with
  a locale switcher in the header. First visit auto-detects from
  the browser's Accept-Language; explicit picks persist via
  cookie. `next-intl` scaffold is single-locale-routed (no
  `/<locale>/...` URL prefix), so adding a new locale is a JSON
  file plus three lines in `lib/i18n/locale.ts`.
- **Signed-in devices** - Settings → Signed-in devices lists every
  active browser session, lets you rename them, and disconnect any
  remote one. A 12-hour grace window prevents a freshly-stolen
  session from immediately locking out the legitimate user; the
  kicked browser wipes its local data and signs out via a Realtime
  channel listener.
- **Reset device** - Settings → Reset device wipes this device's
  IndexedDB + localStorage and signs out, leaving the Supabase
  account intact. Useful for handing the device to someone else, or
  to recover from a corrupted local cache.
- **Try with sample data** - landing page "Try with sample data"
  link seeds a realistic week of meals / weights / body measurements
  into a fresh IDB so visitors can explore before signing up. Auto-
  discarded on sign-in so demo data can't leak into a real account.
- **PWA** - installable on Chrome / Edge / Android via the native
  install banner; iOS Safari gets a Share → Add to Home Screen guide.
  Service worker caches the app shell so it loads instantly and works
  offline once visited.
- **Engagement email (opt-in)** - daily "log your dinner" reminder
  with your streak count, Monday-morning weekly recap with macro
  averages and weight delta, one-time welcome email when you opt in,
  and a transactional "your trial ends tomorrow" nudge 24h before
  Stripe converts a trial into a paid subscription.
- **Browser push notifications (opt-in)** - same daily-reminder
  nudge as the email channel but delivered as a system notification.
  Works on any browser that supports the Web Push API; on iOS the
  PWA must be installed (Share → Add to Home Screen) first. Per-
  device subscription with idempotent send, automatic pruning of
  revoked endpoints (404/410), and a tap that focuses an existing
  tab rather than opening a new one.
- **Privacy-first** - no analytics, no third-party tracking, no
  fingerprinting. Operational error logs strip all identifiers and
  rotate a session token per browser tab so individual users can't
  be tracked. See [/privacy](app/privacy/page.tsx) for the full disclosure.

## Stack

| Concern             | Choice                                                       |
| ------------------- | ------------------------------------------------------------ |
| Framework           | Next.js 16 (App Router, Turbopack)                           |
| Runtime             | React 19                                                     |
| Language            | TypeScript 6 (`strict: true`)                                |
| Styles              | Tailwind CSS 4 + CSS variables                               |
| Motion              | [`motion`](https://motion.dev) (Framer Motion's successor)   |
| UI primitives       | shadcn/ui (Radix)                                            |
| Local storage       | [`idb`](https://github.com/jakearchibald/idb) over IndexedDB |
| Auth + sync         | Supabase (Postgres + RLS, `@supabase/ssr`, email OTP)        |
| AI meal-plan        | Claude Sonnet 4.6 via `@anthropic-ai/sdk` (opt-in)           |
| AI recipes + vision | Claude Haiku 4.5 (faster + cheaper for narrower tasks)       |
| Billing             | Stripe Checkout + Customer Portal + signed webhooks          |
| Email               | Resend (via fetch, no SDK dependency)                        |
| Barcode scan        | `@zxing/browser`                                             |
| Drag and drop       | `@dnd-kit/core` + `@dnd-kit/sortable`                        |
| PWA                 | Manual `public/sw.js` + manifest (no `next-pwa`)             |
| Unit tests          | Vitest                                                       |
| E2E tests           | Playwright (Chromium)                                        |
| Lint                | ESLint 9 flat config via `eslint-config-next`                |
| Format              | Prettier 3                                                   |

## Documentation

The reference docs live in [`docs/`](./docs/):

- **[Development](./docs/development.md)** — requirements, local setup, scripts, tests.
- **[Configuration](./docs/configuration.md)** — every environment variable plus Supabase, Stripe, and push setup.
- **[Architecture](./docs/architecture.md)** — how the local-first sync, billing, AI, and data layers fit together.
- **[Deployment & operations](./docs/deployment.md)** — deploying on Vercel + Supabase, and operational gotchas.
- **[Changelog](./docs/changelog.md)** — shipped work, roughly chronological.
- **[Roadmap](./docs/ROADMAP.md)** — what is planned next.

See also [CONTRIBUTING](./CONTRIBUTING.md), [SECURITY](./SECURITY.md), and the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Contributing

Bug reports and feature requests use the GitHub issue templates in
[`.github/ISSUE_TEMPLATE/`](./.github/ISSUE_TEMPLATE/):

- **Bug report** — repro steps + version + browser + device, with a
  required security-issue checkbox that routes vulnerabilities to
  `security@maqro.app` instead of the public tracker.
- **Feature request** — problem-first form (situation, not solution),
  with optional alternatives + tier.
- **Security report** — surfaced as a non-issue contact link so
  vulnerabilities go to the private inbox.

The `/contact` page mirrors these channels with a category picker
for users who'd rather email than open an issue.

## License

[Attribution-NonCommercial-NoDerivatives 4.0 International](./LICENSE)
