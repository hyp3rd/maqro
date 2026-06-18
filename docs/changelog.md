# Changelog

Shipped work, roughly chronological. For what is planned next, see [the roadmap](./ROADMAP.md).

- **Phase 1–5** - visual revamp; IDB persistence; daily-log history,
  templates, weight tracking; Supabase auth + sync; change-email +
  export + delete-account.
- **Phase 6 (UX + AI)** - drag-and-drop foods; inclusive gender +
  diet filtering; mobile bottom nav; AI auto-fill with deterministic
  fallback.
- **Phase 7 (Recipes)** - manual + AI; apply to any meal slot;
  dietary compatibility derived from ingredients.
- **Phase 8 (Resilience)** - per-call timeouts, OTP-code email
  change, JSON import as dual of export, Playwright auth-sync spec.
- **Phase 9 (Export/import polish)** - progress events; cloud
  exports bucket; preview-before-apply diff dialog.
- **Phase 10 (Camera + sub-macros)** - Sonnet 4.6 vision for label
  photos; sub-macro breakdown (sugars, saturated fat, fiber);
  per-meal slot regenerate.
- **Phase 11 (Sharing + recipes polish)** - public share URLs at
  `/r/[slug]` with three visibility levels; drag-to-reorder
  ingredients; recipe ingredient replacement.
- **Phase 12 (Onboarding + monetization plumbing)** - onboarding
  wizard; AI-cap metering; per-user RBAC role column.
- **Phase 13 (Engagement)** - streaks; weekly recap on Progress;
  daily reminder + weekly recap email crons; welcome email.
- **Phase 14 (Shopping)** - date-ranged aggregation from meal logs
  with copy-as-text export.
- **Phase 15 (Productization - three pillars)** -
  - Trends analytics on Progress (moving averages, plateau
    detection, TDEE recalibration)
  - PWA install prompt + iOS Add-to-Home-Screen guide + manifest
  - Privacy policy split out from `/terms` with GDPR-aware rights
- **Phase 16 (Productization - sharing + version)** - Open Graph +
  Twitter card metadata for shared recipes; `/api/version` + polling
  hook + sonner-toast UpdateBanner; OG metadata on root layout.
- **Phase 17 (Productization - depth)** -
  - **Service worker** for offline app shell (cache-first hashed
    statics, network-first navigations w/ 3s timeout, never-cache
    APIs, user-gated SKIP_WAITING for updates)
  - **Privacy-preserving error monitoring** (no PII, session-rotated
    correlation token, in-house Supabase ingest with rate-limit,
    Next 16 error boundaries + global window-error handler)
  - **Stripe AI Plus** (single SKU, 7-day trial, Checkout + Portal +
    signature-verified idempotent webhook)
  - **Stripe tiered (Pro)** with feature gates for sync / cloud /
    email + grandfather migration for existing users
  - **Admin dashboard** at `/admin` with users list, role editor,
    AI-cap overrides, append-only audit log
- **Phase 18 (Productization - account hygiene + reach)** -
  - **Body measurements** with smoothed trend chart and US Navy /
    Hodgdon–Beckett body-fat estimate
  - **Try with sample data** funnel - landing CTA seeds a realistic
    week into a fresh IDB, auto-discarded on sign-in
  - **Trial-ending email** 24h before Stripe converts a trial,
    idempotent via `trial_ending_email_sent_at`
  - **Health endpoint** at `/api/health` for uptime monitors
  - **Reset device** button in Settings - wipes local IDB +
    localStorage and signs out without touching the Supabase account
  - **Signed-in devices** list + 12h-grace remote disconnect, with
    a Realtime forced-signOut listener that wipes the kicked
    browser's local state
  - **Browser push notifications** alongside the daily-reminder
    email channel - VAPID-signed, per-device subscription, automatic
    pruning of revoked endpoints
- **Phase 19 (Productization - URL deep linking)** -
  - `?upgrade=plus|pro` opens the upgrade dialog directly from the
    landing page (auth-gated; signed-out users bounce to `/login`
    with the upgrade intent preserved)
  - `?view=settings|plan|progress|…` honors deep-link tabs from
    email "Open progress" / "Manage subscription" CTAs
- **Phase 20 (Personalization, recipe UX + security hardening)** -
  - **Personalized AI** - auto-fill + recipe generation biased
    toward the user's recent food rotation
  - **Per-meal coherence warnings** with one-tap regenerate + an
    in-app MFA prompt that verifies in place instead of bouncing
    to `/login`
  - **Recipe scale-by-N** via the apply-recipe Servings stepper +
    **Best-fit** ranking by per-slot macro fit
  - **Meal-prep batch mode** - apply a recipe to one meal slot
    across N consecutive days in one action
  - **Security**: AAL2 enforced on every authenticated API route
    (with a custom lint rule guarding it), Zod-validated request
    bodies, and "Trust this device for 7 days" honored at both the
    proxy and the API gates
- **Phase 21 (Pantry, micronutrients + mobile-first UX)** -
  - **Pantry** inventory (quantity / unit / aisle / density /
    low-stock threshold) with low-stock notifications, a vision
    **photo-scan fill**, and automatic draw-down when a logged food
    matches an item on hand
  - **Shop for me** - pantry gaps → aisle-grouped restock list with
    per-item Uber Eats / DoorDash / Glovo search, **nearby stores** by
    location, and **favourite stores**
  - **Micronutrient tracking** (Pro) - 10 nutrients vs age/sex RDA
    targets, OFF-enriched in the background, charted on Progress and
    in the per-meal detail sheet
  - **Meal detail & insights** - tap a meal for a macro / micro
    breakdown, a deterministic balance + goal-fit check, and optional
    Pro AI "suggestions for next time" behind a metered-request consent
  - **Mobile-first sheets** - guided "Log meal" flow (meal → method →
    full-screen tool with a back affordance), tap-row → bottom-sheet
    editing across the list views, consistent delete confirmations
    with undo, and **fullscreen landscape pinch-zoom** charts
  - **Sync modes** - a per-device choice of local-first (manual save +
    reminder) / auto-save (1–30 min interval) / always-sync, with a
    clearer "Save" affordance and a topbar mode indicator
- **Phase 22 (Health depth + intermittent fasting)** -
  - **Adaptive TDEE** - infer real maintenance from logged intake vs.
    observed weight change, with a recalibration nudge on drift
  - **Hydration** - daily water counter against a bodyweight-scaled,
    unit-aware goal; on the Progress card and in the report
  - **Blood pressure** - systolic / diastolic (+ pulse / note) with
    ACC/AHA classification and a synced Profile history
  - **Intermittent fasting** - a manual fast timer + protocols (16:8 /
    18:6 / 20:4 / custom), an hour-by-hour phase timeline (fed →
    glycogen → fat-burning → ketosis → autophagy), and a synced
    **completed-fast history** with a per-phase breakdown
  - **Quick-add** - a per-meal hub surfacing recent foods one tap away
- **Phase 23 (Profile, reports + data portability)** -
  - **Profile** - birthdate-derived age, a tile-based home (My
    measurements / My docs / Billing & subscription), and a today
    weigh-in that updates Profile weight automatically
  - **Encrypted backups** - a complete bundle (every health table) with
    optional zero-knowledge passphrase encryption and a
    preview-before-apply restore from disk or cloud
  - **Health report → vector PDF** - blood pressure, hydration, fasting,
    calorie/TDEE settings, trends, and micronutrients in a polished PDF
    you can download or archive to encrypted cloud storage
  - **Settings reorg** - Billing & subscription moved to Profile;
    Settings grouped (Account / Security / App settings / Danger zone);
    a goal-phase **target-raise warning** before a cut that
    paradoxically raises today's calories
  - **Supply-chain + CSP** - removed the npm-flagged `supabase` CLI dep
    and added a preinstall + CI denylist guard against unscoped
    `supabase*` packages; a `wasm-unsafe-eval` CSP source so the
    report's WebAssembly PDF engine runs in production
  - **Cross-instance food-lookup cache** - an optional Upstash Redis
    layer in front of Open Food Facts (barcode + search): a cold
    serverless instance is as fast as a warm one, and the browser, AI
    planner, and enrichment cron share one cached entry per query.
    Fail-open — with no Upstash env every lookup falls back to a direct
    fetch; write-through survives the response via `after()`

- **Phase 24 (Meal scheduling, marketing automation, admin depth +
  mobile-logging polish)** -
  - **Meal schedules + AI day-planner** - schedule a recipe across a date
    range / weekdays as a saved "cook once, log for the week" plan
    (surfaced as a one-tap "Log it" on each matching day, never written
    ahead); a "Don't know what to eat today?" one-tap AI day built from
    your own saved recipes against your remaining macros.
  - **Release social automation** - a changelog entry auto-drafts X /
    LinkedIn / Instagram posts in a strict professional voice
    (deterministic tone-lint) for review + approval in `/admin/social`
    before posting, with a branded release OG card.
  - **Admin inbox** - a Resend-backed inbound mailbox with archive (+ undo
    via a real un-dismiss), recipient filter, compose / reply /
    scheduled-send, and new-message push + email to admins.
  - **Complimentary tiers** - grant or revoke Plus / Pro outside Stripe
    (optional expiry) from a user's admin page, stored in a write-locked
    `comp_grants` table so it can't be self-granted; the tier resolver
    takes the highest of paid / comp / grandfather, so a grant never
    downgrades a paid plan.
  - **Admin QoL + visual pass** - destructive confirms with undo, in-flight
    locks, 44px touch targets, mobile-safe data tables, and a consistent
    PageHeader / StatCard / empty-state system across the panel.
  - **Mobile-logging polish** - add food straight from a populated meal's
    menu, a meal-card flash + scroll + light haptic on every add, a
    "calories left today" line, a calorie-target-met celebration, and
    sign-in / upgrade prompts (not toasts) when an AI feature needs an
    account or Pro.
  - **Micronutrient accuracy** - branded staples keep their Open Food Facts
    barcode through logging so the enrichment cron upgrades them from the
    real product, not an AI estimate; CIQUAL generic foods + a
    market-biased food search.

Considered, deliberately not pursuing:

- **Weekly target adherence / calorie banking** - rebalancing a big day
  across the rest of the week assumes over- and under-eating are
  symmetric; they aren't (hormonal + fat-storage asymmetry), and "eat it
  back later" normalizes binge-then-restrict cycles. Per-day targets stay
  the model.

---

[← Documentation index](./README.md) · [Project README](../README.md)
