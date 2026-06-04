-- Server-side store for the user's blood-pressure readings. Mirrors the local
-- IDB store added in db.ts at v17, and follows the same shape as
-- body_measurements (0020): one row per (user, day), date-keyed, last-write-wins.
--
-- `systolic` / `diastolic` are required (a reading is meaningless without the
-- pair) and stored in mmHg — there's no imperial variant for blood pressure, so
-- no unit conversion at the boundary. `pulse` (bpm) and `notes` are optional.
-- The CHECK bounds reject obviously-bad input while still allowing clinical
-- extremes (hypotensive crashes, hypertensive crises).

create table if not exists public.blood_pressure (
  user_id uuid not null references auth.users (id) on delete cascade,
  date text not null check (date ~ '^\d{4}-\d{2}-\d{2}$'),
  systolic double precision not null check (systolic >= 50 and systolic <= 300),
  diastolic double precision not null check (diastolic >= 30 and diastolic <= 200),
  pulse double precision check (pulse >= 20 and pulse <= 300),
  notes text,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create index if not exists blood_pressure_user_idx
  on public.blood_pressure (user_id);

-- RLS — same owner-only pattern as every other synced table.
alter table public.blood_pressure enable row level security;

drop policy if exists "blood_pressure_owner_all" on public.blood_pressure;
create policy "blood_pressure_owner_all"
  on public.blood_pressure
  for all
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

-- updated_at trigger so the sync engine's last-write-wins comparison sees a
-- real timestamp on every server-side write.
drop trigger if exists blood_pressure_set_updated_at on public.blood_pressure;
create trigger blood_pressure_set_updated_at
  before update on public.blood_pressure
  for each row execute function public.set_updated_at ();
