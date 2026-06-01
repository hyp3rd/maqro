-- Stripe-driven billing state for the AI Plus subscription.
--
-- We extend `profiles` rather than adding a separate `billing` table
-- because there's a 1:1 between user and subscription (no team
-- plans), and the billing surface area is small enough that another
-- table would just mean an extra join in the hot path. The existing
-- `is_premium` column (added in migration 0011) becomes a derived
-- flag the webhook writes when the subscription is active.
--
-- The Stripe customer ID is created lazily by /api/billing/checkout
-- on the first attempted upgrade and reused thereafter (per Stripe's
-- guidance — never create a new customer for an existing user).
-- The subscription ID lets us cancel / look up / update without
-- another round-trip to find it.

alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  -- Mirrors the Stripe subscription status enum: 'trialing',
  -- 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired',
  -- 'unpaid'. We don't enforce the enum at the DB level because
  -- Stripe may add new statuses; keeping it as free-form text lets
  -- us forward whatever they send and let the application decide
  -- what counts as "entitled".
  add column if not exists subscription_status text,
  -- ISO-string timestamp of when the current paid period ends. Used
  -- by the Settings UI to show "renews on X" and by the AI cap
  -- check to grace a user whose subscription is canceled but
  -- still inside the paid period.
  add column if not exists current_period_end timestamptz;

-- Index on stripe_customer_id so the webhook handler can find a
-- profile quickly given just the customer ID (the most common
-- lookup path — Stripe events carry the customer, not our UUID).
create unique index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

-- Webhook idempotency. Stripe retries on any non-2xx and may send
-- the same event multiple times under at-least-once semantics. We
-- record each successfully-processed event ID and short-circuit
-- duplicates before any state change.
create table if not exists public.stripe_webhook_events (
  -- The Stripe event ID (`evt_…`). Primary key both for uniqueness
  -- and so an INSERT ON CONFLICT becomes the natural dedup gate.
  id text not null primary key,
  -- The event type, kept for audit / debugging ("which kind of
  -- event was this?"). Free-form text — Stripe adds new types
  -- and we don't want a hard schema lock.
  type text not null,
  created_at timestamptz not null default now()
);

create index if not exists stripe_webhook_events_created_idx
  on public.stripe_webhook_events (created_at desc);

alter table public.stripe_webhook_events enable row level security;
-- No policies — service-role only. The webhook handler bypasses
-- RLS; nobody else should ever read this table.
drop policy if exists "stripe_webhook_events_no_access"
  on public.stripe_webhook_events;
