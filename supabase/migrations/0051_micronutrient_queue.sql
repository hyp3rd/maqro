-- Work queue for the micronutrient enrichment cron.
--
-- When a Pro user saves a daily log, the client fire-and-forgets the
-- distinct food names that don't yet have a micronutrient profile into
-- this table. The hourly cron (`/api/cron/enrich-micronutrients`) drains
-- it: for each row it looks the food up on Open Food Facts, writes a
-- `micronutrient_profiles` row, and deletes the queue row.
--
-- Keyed by (user_id, name_key) with a unique constraint so re-enqueuing
-- the same food is a no-op (on-conflict-do-nothing). `off_code` carries
-- the exact OFF barcode when the logged food came from an OFF source,
-- so the cron can do a precise product lookup instead of a fuzzy name
-- search. `attempts` caps retries so a permanently-unmatchable name
-- doesn't loop forever.

create table if not exists public.micronutrient_queue (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  name_key text not null check (char_length(name_key) between 1 and 200),
  off_code text check (off_code is null or char_length(off_code) <= 32),
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name_key)
);

-- The cron drains oldest-first across all users; index supports that
-- scan and the per-user dedupe lookup.
create index if not exists micronutrient_queue_created_idx
  on public.micronutrient_queue (created_at);
create index if not exists micronutrient_queue_user_idx
  on public.micronutrient_queue (user_id);

-- RLS — owner-only. The client inserts its own rows; the cron uses the
-- service-role key and bypasses RLS entirely. There is no client read
-- path (the queue is server-internal), but the owner-only policy keeps
-- a user from seeing or seeding another user's queue if they tried.
alter table public.micronutrient_queue enable row level security;

drop policy if exists "micronutrient_queue_owner_all" on public.micronutrient_queue;
create policy "micronutrient_queue_owner_all"
  on public.micronutrient_queue
  for all
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

drop trigger if exists micronutrient_queue_set_updated_at on public.micronutrient_queue;
create trigger micronutrient_queue_set_updated_at
  before update on public.micronutrient_queue
  for each row execute function public.set_updated_at ();

-- Not published to realtime: the queue is server-internal work state,
-- never read by the client, so there's nothing to stream.
