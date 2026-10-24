-- Per-date training-session overrides (FREE): "today is a rest day", "moved
-- legs to Thursday". The weekly training template rides the profile payload;
-- a one-day change lives here instead, one row per (user, day), so editing a
-- day never rewrites — or conflicts on — the whole profile, and rows stay
-- bounded per day instead of growing the profile blob forever.
--
-- An override changes THAT day's planned target only (no rebalancing of the
-- rest of the week — docs/changelog.md, calorie banking non-goal). Clients
-- read `day` through `parseTrainingDay` (packages/core/src/training.ts) and
-- ignore a malformed row, so the CHECK below is a shape guard, not the
-- validator. Removing an override ("back to plan") is a hard DELETE, synced
-- through the client's tombstones.
--
-- Mirrors the date-keyed last-write-wins tables (supplement_intake, 0072):
-- owner RLS, set_updated_at for the sync engine's optimistic concurrency,
-- realtime so another device sees the change live, and the restrictive
-- second-factor policy every end-user table carries (0079). The IDB side is
-- lib/db.ts v22.

create table if not exists public.training_day_overrides (
  user_id uuid not null references auth.users (id) on delete cascade,
  date text not null check (date ~ '^\d{4}-\d{2}-\d{2}$'),
  -- The session for this day: a TrainingDay { type, intensity?, time?,
  -- durationMin? } (packages/core/src/types.ts).
  day jsonb not null check (jsonb_typeof(day) = 'object'),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create index if not exists training_day_overrides_user_idx on public.training_day_overrides (user_id);

alter table public.training_day_overrides enable row level security;

drop policy if exists "training_day_overrides_owner_all" on public.training_day_overrides;
create policy "training_day_overrides_owner_all" on public.training_day_overrides for all using (
  user_id = auth.uid ()
)
with
  check (user_id = auth.uid ());

-- Second factor (0079): an AAL1 session of an MFA-enrolled user must not
-- read or write this table either.
drop policy if exists "mfa_second_factor_required" on public.training_day_overrides;
create policy "mfa_second_factor_required" on public.training_day_overrides
  as restrictive
  for all
  to authenticated
  using ((select public.session_satisfies_mfa()))
  with check ((select public.session_satisfies_mfa()));

drop trigger if exists training_day_overrides_set_updated_at on public.training_day_overrides;
create trigger training_day_overrides_set_updated_at before update on public.training_day_overrides for each row
execute function public.set_updated_at ();

-- Realtime: emit change events (DELETE included — "back to plan" on one
-- device must reach the others; the client owner-checks DELETE events in
-- lib/sync/realtime.ts).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'training_day_overrides'
  ) then
    alter publication supabase_realtime add table public.training_day_overrides;
  end if;
end $$;
