-- Add the Upstash (Open Food Facts cache) per-component status to the
-- status-probe history. Upstash is an OPTIONAL, fail-open dependency: an
-- outage doesn't take overall health to fail (OFF lookups fall through to a
-- direct fetch), so this column is surfaced on /status alongside Stripe but
-- never feeds `overall_ok`. Existing rows backfill to 'skipped'.
alter table public.status_probes
  add column if not exists upstash_status text not null default 'skipped'
    check (upstash_status in ('ok', 'fail', 'skipped'));
