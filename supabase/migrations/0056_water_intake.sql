-- Server-side store for the user's daily water intake. Mirrors the local
-- IDB store added in db.ts at v16.
--
-- One row per (user, day). `date` is the `YYYY-MM-DD` local date — the same
-- date-keyed, last-write-wins shape as `weight_history`. `ml` is the day's
-- cumulative intake in millilitres (storage is always metric, like weight in
-- kg; the imperial fl-oz display happens at the UI boundary). The daily goal
-- is NOT stored here — it rides the profile (`waterGoalMl`).

create table if not exists public.water_intake (
  user_id uuid not null references auth.users (id) on delete cascade,
  date text not null check (date ~ '^\d{4}-\d{2}-\d{2}$'),
  ml double precision not null check (ml >= 0 and ml <= 20000),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create index if not exists water_intake_user_idx
  on public.water_intake (user_id);

-- RLS — same owner-only pattern as every other synced table.
alter table public.water_intake enable row level security;

drop policy if exists "water_intake_owner_all" on public.water_intake;
create policy "water_intake_owner_all"
  on public.water_intake
  for all
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

-- updated_at trigger so the sync engine's last-write-wins comparison sees a
-- real timestamp on every server-side write.
drop trigger if exists water_intake_set_updated_at on public.water_intake;
create trigger water_intake_set_updated_at
  before update on public.water_intake
  for each row execute function public.set_updated_at ();

-- Realtime: emit change events so water stays live across devices.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'water_intake'
  ) then
    alter publication supabase_realtime add table public.water_intake;
  end if;
end $$;
