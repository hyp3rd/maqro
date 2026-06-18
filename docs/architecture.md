# Architecture

How Maqro is put together — the persistence layers, the route map, and where
the pure logic lives.

Single-page client app. View state lives in
[`macro-calculator.tsx`](../macro-calculator.tsx) (the root component, named
before the macro-calculator → maqro rebrand) and is wired into a
sidebar-driven `AppShell`. Persistence is layered:

1. **IndexedDB (always)** - [`lib/db.ts`](../lib/db.ts) is the source of
   truth on each device. Stores: `profile`, `dailyLogs`,
   `weightHistory`, `bodyMeasurements`, `customFoods`,
   `mealTemplates`, `recipes`, `pantryItems`, `pantryNotifications`,
   `shoppingListMeta`, `micronutrientProfiles`, `favoriteStores`,
   `deletions`. All IDs are
   client-minted UUIDs so the same row exists locally and on the
   server under the same key.
1. **Supabase (when signed in)** - same tables, RLS-scoped to owner.
   [`lib/sync/`](../lib/sync/) reconciles IDB ↔ Supabase. On-demand
   re-sync via the topbar pill.
1. **Auth cookies** - refreshed by [`proxy.ts`](../proxy.ts) (Next.js
   16 renamed `middleware` → `proxy`).
1. **Service worker** - [`public/sw.js`](../public/sw.js) caches the
   app shell + content-hashed static assets, network-first for
   navigations with a 3-second timeout, never caches `/api/*`. Only
   registers in production builds.

Pure logic (`lib/macros.ts`, `lib/meal-planner.ts`, `lib/trends.ts`,
`lib/streaks.ts`, `lib/weekly-recap.ts`, `lib/shopping-list.ts`,
`lib/billing/tiers.ts`, `lib/sync/mappers.ts`) stays free of React
and IDB so it's unit-testable in isolation.

```text
proxy.ts                            # Next 16 proxy - refreshes Supabase session cookies
app/
  layout.tsx                        # Theme, fonts, OG metadata
  manifest.ts                       # PWA manifest at /manifest.webmanifest
  page.tsx                          # Single-page mount point
  globals.css                       # Monochrome design tokens
  error.tsx                         # Segment error boundary (reports + offers retry)
  global-error.tsx                  # Layout-level error boundary (HTML-shell fallback)
  privacy/page.tsx                  # Privacy policy (GDPR-aware)
  terms/page.tsx                    # Terms (points to /privacy for data handling)
  login/page.tsx                    # Email-OTP sign-in
  auth/{callback,confirm}/route.ts  # PKCE + magic-link verify
  r/[slug]/page.tsx                 # Public recipe view with macros + OG meta
  capture/[id]/page.tsx             # QR-flow companion capture (camera handoff)
  login/recovery/page.tsx           # Recovery - sign in via the backup email's one-time code
  contact/page.tsx                  # Public support / contact form (routes to configurable inbox)
  pricing/page.tsx                  # Full feature comparison + monthly/yearly toggle + FAQ
  status/page.tsx                   # Public service status - cron-probed uptime + recent incidents
  about/page.tsx                    # Brand + version + every-link-in-one-place + Check for updates
  changelog/page.tsx                # In-app changelog with "what's new" indicator
  help/page.tsx                     # User-facing help / FAQ
  sitemap.ts                        # SEO sitemap (static routes)
  robots.ts                         # Robots policy
  admin/                            # /admin - gated by lib/rbac
    layout.tsx                      #   noindex chrome with role check + redirect
    page.tsx                        #   Overview / health board
    users/page.tsx                  #   Paginated users list with status filters + per-row actions
    users/[id]/page.tsx             #   Per-user detail - ban (24h/7d/30d/permanent), trace, cancel sub
    audit/page.tsx                  #   Audit log viewer - tabs for admin actions + Supabase auth events
    errors/page.tsx                 #   Captured client/server error stream
    webhooks/page.tsx               #   Stripe webhook history + per-event replay
    inbox/{,[id]}/page.tsx          #   Received email viewer (Resend) - list + sandboxed detail
    inbox/outgoing/{,[id]}/page.tsx #   Outgoing log + per-message live Resend status + cancel
    onboarding/page.tsx             #   First-run wizard funnel (aggregate counters, no PII)
    settings/page.tsx               #   Runtime-configurable app settings (support inbox, …)
  api/
    version/route.ts                # GET { version } - drives the update banner
    errors/route.ts                 # POST error events into the privacy-stripped log
    off-search/route.ts             # Same-origin OFF proxy
    off-barcode/[code]/route.ts     # OFF barcode lookup
    identify-meal/route.ts          # Sonnet 4.6 vision (camera identify)
    identify-pantry/route.ts        # Vision: fridge/shelf photo → pantry items
    voice-log/route.ts              # Haiku 4.5: spoken meal → structured foods
    meal-insights/route.ts          # Haiku 4.5: per-meal "next time" suggestions (Pro)
    shopping/{suggest,nearby,geocode}/route.ts  # Restock list, store search, geocode
    meal-plan/route.ts              # Sonnet 4.6 agent loop + coherence validator
    recipes/generate/route.ts       # Haiku 4.5 recipe generator
    recipes/[id]/share/route.ts     # Toggle visibility + mint slug
    recipes/import/[slug]/route.ts  # Server-side fetch + import a shared recipe
    capture/{init,[id],[id]/{barcode,photo-done}}/route.ts  # Camera-capture handoff
    delete-account/route.ts         # Admin.deleteUser (service-role)
    account/backup-email/{,start,verify}/route.ts  # Set / verify / clear backup recovery email
    auth/recovery/route.ts          # Issue a backup-email recovery code (and verify via /auth/confirm)
    auth/mfa/trusted-devices/{,[id],check}/route.ts  # 7-day MFA bypass - list/create/revoke + per-row revoke + login-time check
    billing/usage/route.ts          # GET current-month AI usage + tier + plan state
    billing/checkout/route.ts       # Create Stripe Checkout Session
    billing/portal/route.ts         # Create Stripe Customer Portal Session
    billing/webhook/route.ts        # Stripe webhook (signature-verified + idempotent)
    admin/users/route.ts            # Admin user list with email search + status filters
    admin/users/[id]/route.ts       # Single-user detail merge (auth + profile + Stripe + audit)
    admin/users/[id]/{role,usage}/route.ts  # Mutate role / reset usage + audit
    admin/users/[id]/action/route.ts        # Dispatch: ban / unban / trace / untrace / cancel_subscription
    admin/users/[id]/trace-events/route.ts  # Recent trace_events for a flagged user (drives the detail panel)
    admin/session/end/route.ts      # Explicit "Exit admin" - closes admin_sessions row + audit
    admin/audit/route.ts            # Read audit log
    admin/errors/route.ts           # Read captured errors (cursor-paginated)
    admin/webhooks/{,[id]/{,replay}}/route.ts  # List Stripe events, fetch detail, replay one
    admin/inbox/{,[id]}/route.ts    # Resend receiving - list + per-message detail
    admin/inbox/send/route.ts       # Admin-issued outbound (compose + reply, scheduled-send)
    admin/inbox/outgoing/{,[id]/{,cancel}}/route.ts  # Outgoing list, retrieve, cancel scheduled
    admin/settings/route.ts         # Read + update runtime app_settings (whitelist + per-key validators)
    onboarding/events/route.ts      # Anonymous funnel-counter ingest (aggregate-only, no PII)
    support/route.ts                # Public contact-form ingest → forwards to configurable inbox
    auth/signup-check/route.ts      # Pre-flight signup abuse caps (rate-limit + disposable-domain block)
    notifications/welcome/route.ts  # Send welcome email (idempotent)
    health/route.ts                 # GET - Supabase + Stripe liveness for uptime monitors
    devices/{register,disconnect}/route.ts  # Upsert / remote-disconnect signed-in devices (12h grace)
    push/{subscribe,unsubscribe,vapid-key,events}/route.ts  # Web Push subscription + SW engagement callback
    cron/{daily-reminder,weekly-recap,trial-ending,retention,status-probe}/route.ts  # Vercel cron handlers
components/
  shell/                            # AppShell, Sidebar, Topbar, MobileBottomNav,
                                    #   SyncManager, SyncModeController (auto-save /
                                    #   always-sync push + local-first reminder),
                                    #   SyncStatusPill + SyncModeIndicator + the
                                    #   SaveReminderDialog, InstallPrompt, UpdateBanner,
                                    #   ServiceWorkerProvider, GlobalErrorHandler,
                                    #   StorageBanner, Footer, BugReportDialog,
                                    #   PageTopBar (public-page back-to-app chrome),
                                    #   MiniLineChart (Catmull-Rom sparklines),
                                    #   ChartZoomDialog + ChartFullscreen (mobile
                                    #   landscape pinch-zoom), DateNavigator,
                                    #   PastDueBanner (Stripe dunning),
                                    #   CookieNotice (informational, no analytics)
  macro/                            # Calculator, Meal Plan, ProgressView (with
                                    #   TrendsSection: plateau + TDEE recal),
                                    #   ShoppingListView, RecipesView, MyFoodsView,
                                    #   SettingsView (+ BillingSection, MfaSection,
                                    #   BackupEmailSection, ConnectedAccountsSection,
                                    #   SignedInDevicesSection, TrustedDevicesSection,
                                    #   UnitsSection: metric / imperial toggle),
                                    #   InfoExplainer (info-icon → Dialog for BMR /
                                    #   TDEE / safety-floor explainers),
                                    #   UpgradeDialog (Plus / Pro selector),
                                    #   OnboardingWizard, ShareRecipeDialog,
                                    #   CameraIdentifyDialog, ImportPreviewDialog,
                                    #   PantryView (+ PantryScanSheet/ReviewDialog),
                                    #   ShopForMeDialog, NearbyStores, FavoriteStores,
                                    #   MicronutrientsSection, MealDetailSheet,
                                    #   LogMealSheet + FoodSearchSheet (guided mobile
                                    #   add-food), SheetAction (shared sheet primitives)
  icons/                            # In-tree SVGs (e.g. GoogleLogo for OAuth button)
  marketing/                        # StructuredData (JSON-LD for landing SEO)
  ui/                               # shadcn primitives
hooks/
  use-user.ts                       # Supabase auth subscription
  use-user-role.ts                  # Client-side isAdmin (UX hint only)
  use-profile.ts                    # IDB-hydrated profile state
  use-daily-log.ts                  # IDB-hydrated day log state
  use-food-search.ts                # Debounced merged search
  use-today.ts                      # Live today-date (rolls at midnight)
  use-ai-usage.ts                   # Current-month AI usage + tier
  use-subscription-status.ts        # Billing-tier + past-due state polling (drives PastDueBanner)
  use-notification-prefs.ts         # Email + browser-push subscription toggles
  use-pwa-install.ts                # beforeinstallprompt + iOS detection
  use-version-check.ts              # Poll /api/version + visibility-change
  use-mobile.tsx                    # Breakpoint helper
lib/
  db.ts                             # IndexedDB wrapper (idb)
  macros.ts                         # BMR, TDEE, target calories
  meal-planner.ts                   # 3×3 Cramer-based portion solver
  trends.ts                         # Smoothing, plateau detection, TDEE recalibration
  streaks.ts                        # Consecutive-logged-days computation
  weekly-recap.ts                   # 7-day rollup for Progress + email
  shopping-list.ts                  # Aggregate foods across a date range
  meal-insights.ts                  # Deterministic per-meal balance + goal-fit flags
  rda.ts                            # Micronutrient metadata + age/sex RDA targets
  micronutrients/                   # Per-portion micro aggregation + window/averages
  pantry/                           # Pantry draw-down + consume planning
  shopping/                         # Aisle categorize + delivery providers + gaps
  diet.ts                           # Diet classifier (catalog + AI)
  app-url.ts                        # Canonical app URL helper
  app-settings.ts                   # Key/value runtime config (60s in-memory cache, fail-OPEN read)
  error-reporter.ts                 # Client + server error ingest
  sw-update-bus.ts                  # SW-update pub/sub (provider → banner)
  links.ts                          # Repo + canonical URLs
  version.ts                        # APP_VERSION from package.json
  rbac.ts                           # currentUserRole / requireAdmin / writeAuditLog
  share-slug.ts                     # Slug generation + validation
  billing/
    usage.ts                        # checkAndIncrementAiUsage + per-tier caps
    tiers.ts                        # Tier resolver + AI_CAPS + FEATURES gates
    stripe.ts                       # Lazy-init client + price registry
    plans.ts                        # Marketing plan data + feature comparison matrix (/pricing + landing)
  ai/                               # Anthropic SDK wrappers, prompt builders,
                                    #   plan / recipe / vision converters, coherence
                                    #   validator (lib/ai/plan-coherence.ts)
  email/                            # Resend wrapper + HTML templates + receiving-API client
  auth/                             # signup-guard (rate limit + disposable-domain block)
  telemetry/                        # Onboarding funnel emit helper (aggregate-only)
  status/                           # Probe-row aggregation (uptime %, heat-strip buckets, incident inference)
  units.ts                          # kg ↔ lb + cm ↔ ft·in conversions, formatters, locale auto-detect
  health/                           # Shared dependency-check helpers (/api/health + cron status-probe)
  push/                             # VAPID config, server send helper, client subscribe flow
  devices/                          # session_id extraction, registry, forced-signOut listener
  demo-data.ts                      # Sample dataset + clearDemoModeData() reset path
  storage/                          # Supabase Storage helpers (exports bucket)
  capture/                          # QR-flow capture state machine
  sync-mode.ts                      # Per-device sync-mode preference (localStorage)
  sync/                             # IDB ↔ Supabase reconciler
  supabase/                         # env / client / server / proxy
data/food-database.ts               # Built-in foods
public/
  sw.js                             # Service worker (cache-first hashed assets,
                                    #   network-first navigations, offline fallback)
  offline.html                      # JS-free offline fallback page
supabase/migrations/
  0001_init.sql                            # Tables + RLS (first five stores)
  0002_custom_foods_diet_kind.sql          # Add diet_kind to custom_foods
  0003_recipes.sql                         # recipes table
  0004_exports_storage.sql                 # Private exports Storage bucket
  0005_captures.sql                        # Camera-capture handoff state
  0006_realtime_publication.sql            # Realtime publication setup
  0007_sort_order.sql                      # Stable ordering across rows
  0008_macros_breakdown.sql                # Sub-macros (sugars, sat fat, fiber)
  0009_recipe_sharing.sql                  # share_slug column + RLS for /r/[slug]
  0010_recipe_share_visibility.sql         # public / members / disabled visibility
  0011_ai_usage.sql                        # ai_usage_monthly + is_premium
  0012_profile_role.sql                    # role column (user | admin)
  0013_notification_preferences.sql        # Email opt-in toggles
  0014_welcome_sent_at.sql                 # Welcome idempotency flag
  0015_error_log.sql                       # error_log (no PII, session-rotated token)
  0016_stripe_billing.sql                  # Stripe IDs + webhook events idempotency
  0017_tiered_billing.sql                  # Pro tier + grandfather flag + grace until
  0018_admin_audit_log.sql                 # Append-only admin audit log
  0019_localized_reminder.sql              # Per-user reminder_hour + last_reminder_sent_date
  0020_body_measurements.sql               # waist / neck / hip cm log + RLS + Realtime
  0021_trial_ending_email.sql              # trial_ending_email_sent_at idempotency stamp
  0022_user_devices.sql                    # Signed-in devices + 12h-grace disconnect RPC
  0023_push_subscriptions.sql              # Web Push subscriptions + push_enabled flag
  0024_user_devices_geo.sql                # IP + city/country/region columns on user_devices
  0025_push_send_log.sql                   # Push delivery log (retention: 90d)
  0026_push_event_log.sql                  # SW engagement log - click / close (retention: 90d)
  0027_stripe_webhook_payload.sql          # Persist Stripe event payloads for admin replay
  0028_user_devices_device_id.sql          # Stable per-browser device_id on user_devices
  0029_backup_email.sql                    # backup_email + verified_at + pending OTP columns
  0030_backup_email_collision_check.sql    # email_taken_by_other_user RPC for backup-email start
  0031_mfa_trusted_devices.sql             # "Trust this device for 7 days" - skip MFA window
  0032_auth_audit_log_view.sql             # public view exposing auth.audit_log_entries to service-role
  0033_profiles_traced.sql                 # profiles.traced bool flag for admin observability tracing
  0034_admin_sessions.sql                  # admin_sessions table - bracket admin-panel presence with start/end events
  0035_trace_events.sql                    # trace_events table - per-user observability log driven by profiles.traced
  0036_auth_throttle.sql                   # Rate-limit RPC + counter table for auth/signup/support surfaces
  0037_billing_email_stamps.sql            # past_due_email_sent_at + cancel_at_period_end_email_sent_at idempotency
  0038_recipe_import_allowlist.sql         # Domain allowlist for the URL recipe importer (SSRF defense)
  0039_recipes_metadata.sql                # ingredients_text / instructions / servings / scale columns on recipes
  0040_app_settings.sql                    # Generic key/value runtime config (admin-managed via service-role)
  0041_admin_sent_emails.sql               # Outgoing email log (Resend id ↔ admin who sent it, scheduled_at)
  0042_onboarding_telemetry.sql            # Aggregate-only onboarding funnel counters (no PII; see migration comment)
  0043_status_probes.sql                   # Public status-probe history (5-min cron, 90-day retention, RLS-readable)
  0044_pantry_items.sql                    # Pantry inventory table + RLS + Realtime
  0045_pantry_notifications.sql            # Low-stock notification rows
  0046_pantry_item_category.sql            # Aisle/category column on pantry items
  0047_favorite_stores.sql                 # Saved favourite stores for Shop-for-me
  0048_pantry_item_density.sql             # Density (g/ml) for unit conversions
  0049_pantry_low_threshold.sql            # Per-item low-stock threshold
  0050_captures_size_limit.sql             # Upload size cap on camera-capture handoff
  0051_micronutrient_queue.sql             # Enrichment work queue (name → OFF lookup)
  0052_micronutrient_profiles.sql          # Name-keyed per-100g micronutrient profiles
  0053_custom_food_micronutrients.sql      # Micronutrients on custom foods
  0054_micronutrient_source_ai.sql         # Mark AI-estimated micro profiles distinctly
tests/e2e/                                 # Playwright smoke + gated auth-sync spec
```

---

[← Documentation index](./README.md) · [Project README](../README.md)
