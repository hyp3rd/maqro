-- Per-user micronutrient profiles — the derived cache the enrichment
-- cron writes and the Progress view / report reads. Mirrors the local
-- IDB store added in db.ts at v14.
--
-- One row per (user, normalized food name). `values` is a jsonb map of
-- the ~10 tracked nutrients → per-100g value in each nutrient's
-- canonical unit (see lib/rda.ts). A `source = 'miss'` row with empty
-- `values` records "Open Food Facts had no match" so the cron stops
-- re-querying that name every hour.
--
-- This is a CACHE, not user-authored data: the cron can rebuild it,
-- so there are no tombstones. It still syncs (Pro users only —
-- sync is Pro-gated) so the same enrichment is available across a
-- user's devices without each device re-deriving it.

create table if not exists public.micronutrient_profiles (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  name_key text not null check (char_length(name_key) between 1 and 200),
  values jsonb not null default '{}'::jsonb,
  source text not null default 'search'
    check (source in ('barcode', 'search', 'miss')),
  source_code text check (source_code is null or char_length(source_code) <= 32),
  enriched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name_key)
);

create index if not exists micronutrient_profiles_user_idx
  on public.micronutrient_profiles (user_id);

alter table public.micronutrient_profiles enable row level security;

drop policy if exists "micronutrient_profiles_owner_all" on public.micronutrient_profiles;
create policy "micronutrient_profiles_owner_all"
  on public.micronutrient_profiles
  for all
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

drop trigger if exists micronutrient_profiles_set_updated_at on public.micronutrient_profiles;
create trigger micronutrient_profiles_set_updated_at
  before update on public.micronutrient_profiles
  for each row execute function public.set_updated_at ();

-- Realtime: a profile written by the cron should light up the open
-- Progress view without a manual refresh.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'micronutrient_profiles'
  ) then
    alter publication supabase_realtime add table public.micronutrient_profiles;
  end if;
end $$;
