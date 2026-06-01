-- Stripe webhook payload + processing telemetry.
--
-- Adds the fields needed to: (1) inspect what Stripe actually sent
-- in the admin UI, (2) replay a previously-recorded event by re-
-- running the dispatcher against the stored payload, (3) see at a
-- glance which events succeeded vs failed.
--
-- Why these columns and not others:
--
--   - `payload jsonb` — the full Stripe `event` object (id, type,
--     created, data, request, livemode). Replay needs every field
--     because Stripe's TypeScript types expect a complete shape;
--     storing a partial would force us to invent fields on replay.
--     jsonb is correct here over json: we want index-on-key support
--     later, and the storage cost is identical.
--
--   - `processed_at timestamptz` — set when the dispatcher finishes,
--     whether it succeeded or threw. NULL until then. Useful for
--     spotting events that crashed mid-dispatch (status='error' but
--     processed_at='now') vs events that were never delivered at all
--     (the row never existed in the first place).
--
--   - `processing_status text` — 'success' | 'error'. Free-form text
--     not CHECK-constrained because we may add 'skipped' or 'replayed'
--     statuses later and don't want a migration to do it.
--
--   - `processing_error text` — error message when status='error'.
--     Stack traces don't go here; that's what `error_log` is for.
--
--   - `replayed_at`, `replayed_by` — set when an admin manually
--     replays an event. NULL on first processing. Lets the admin UI
--     show "Replayed 2 hours ago by admin@..." and the audit trail
--     points back to who initiated.
--
-- Backfill: existing rows have NULL payload — they can't be replayed,
-- only inspected by id/type/created_at. That's fine: anything older
-- than the deploy of this migration was already processed; replay
-- exists for events recorded AFTER this lands.
--
-- Retention: lib/retention.ts already covers stripe_webhook_events
-- at 30 days. With payloads stored, the table grows ~10–20 KB per
-- event × ~1k events / month = trivial. Still under the retention
-- floor — keep the 30-day window.

alter table public.stripe_webhook_events
  add column if not exists payload jsonb,
  add column if not exists processed_at timestamptz,
  add column if not exists processing_status text,
  add column if not exists processing_error text,
  add column if not exists replayed_at timestamptz,
  add column if not exists replayed_by uuid references auth.users (id) on delete set null;

-- Index on processing_status so the admin viewer can quickly slice
-- "show only failures" without scanning the table. Partial index
-- because the common case is success; we only need the failures
-- to be cheap to find.
create index if not exists stripe_webhook_events_failed_idx
  on public.stripe_webhook_events (created_at desc)
  where processing_status = 'error';
