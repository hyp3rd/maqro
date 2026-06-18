-- Staleness-refresh cooldown for micronutrient profiles.
--
-- A daily sweep (`/api/cron/refresh-stale-micronutrients`) re-enriches OLD
-- approximate profiles (`source in ('search','ai')`) in case the product has
-- since appeared in Open Food Facts / CIQUAL. `enriched_at` can't gate this: the
-- enrichment cron REWRITES it on every successful upsert, so it tracks "last
-- successful write", not "last refresh ATTEMPT". A separate `refreshed_at` is
-- stamped by the sweep when it queues a row, so a profile that keeps missing
-- isn't re-swept every day (the cooldown), even if the re-enrich finds nothing.
--
-- Server-only: stamped + read by the service-role sweep/cron; the client UI
-- never needs it, so it is NOT added to the sync mapper/select (that's why the
-- `breakdown`-omission class of bug doesn't apply here — no mapper reads it).
-- Null = never swept (eligible immediately once old enough).

alter table public.micronutrient_profiles
  add column if not exists refreshed_at timestamptz;

comment on column public.micronutrient_profiles.refreshed_at is
  'When the staleness sweep last queued this profile for re-enrichment (the cooldown). Distinct from enriched_at, which the cron rewrites on every successful write. Server-only; not synced.';

-- Supports the sweep''s eligibility scan (approximate sources, ordered by age)
-- without a full-table seq scan as the profile count grows.
create index if not exists micronutrient_profiles_stale_idx
  on public.micronutrient_profiles (enriched_at)
  where source in ('search', 'ai');
