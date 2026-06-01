-- C2 tiered billing — extends C1's single-SKU model with a Pro
-- tier that unlocks sync, cloud export, and email subscriptions.
--
-- Schema changes:
--   1. `stripe_price_id`     — which Stripe Price the user
--      currently pays for. Lets resolveTier() distinguish Plus
--      from Pro without re-querying Stripe each render.
--   2. `is_grandfathered`    — boolean flag for users who existed
--      before the C2 launch. Set to true via a one-shot UPDATE
--      below for any signed-in user as of the migration date.
--      The 12-month grace period is enforced by application code
--      (`grandfather_until` below), not by automatically clearing
--      this flag; that gives the maintainer the option to extend.
--   3. `grandfather_until`   — when the grandfather grace expires.
--      After this date the user falls back to whatever their
--      paid status says (or free).

alter table public.profiles
  add column if not exists stripe_price_id text,
  add column if not exists is_grandfathered boolean not null default false,
  add column if not exists grandfather_until timestamptz;

-- Grandfather every existing user as of the migration date. This
-- runs at deploy time and is idempotent — re-running won't
-- re-grandfather users who've since had the flag cleared by an
-- admin, because the WHERE filters out rows with the flag already
-- set.
--
-- 12-month grace from migration deploy. Date arithmetic happens
-- server-side at migration time so all grandfathered users share
-- a consistent expiry, no clock drift between runs.
update public.profiles
set
  is_grandfathered = true,
  grandfather_until = now() + interval '12 months'
where
  is_grandfathered = false
  and grandfather_until is null;

-- Index on stripe_price_id keeps tier-resolution queries fast
-- when filtered by price (e.g. "how many Pro subscribers do we
-- have?" for the admin dashboard's health board).
create index if not exists profiles_stripe_price_idx
  on public.profiles (stripe_price_id)
  where stripe_price_id is not null;
