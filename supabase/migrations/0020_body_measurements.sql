-- Server-side store for body measurements (waist / neck / hips +
-- optional note). Mirrors the local IDB store added in db.ts at v9.
--
-- Schema mirrors `weight_history`: one row per (user, YYYY-MM-DD),
-- date as a text key (not a postgres date) so it round-trips
-- identically to whatever the client wrote. All circumferences
-- nullable so the user can log partial measurements; the client's
-- body-fat estimator skips entries with missing required inputs.
--
-- Each circumference is bounded by `check` constraints — a > 0 floor
-- prevents accidentally storing 0 cm (which would corrupt the
-- body-fat formula's log10 input), and an upper bound catches
-- transposed-digit mistakes (e.g. someone typing 850 instead of 85).

create table if not exists public.body_measurements (
  user_id uuid not null references auth.users (id) on delete cascade,
  date text not null check (date ~ '^\d{4}-\d{2}-\d{2}$'),
  waist_cm double precision check (waist_cm > 0 and waist_cm < 300),
  neck_cm double precision check (neck_cm > 0 and neck_cm < 100),
  hips_cm double precision check (hips_cm > 0 and hips_cm < 300),
  notes text,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- RLS — same owner-only pattern as every other synced table.
alter table public.body_measurements enable row level security;

drop policy if exists "body_measurements_owner_all" on public.body_measurements;
create policy "body_measurements_owner_all"
  on public.body_measurements
  for all
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

-- updated_at trigger so the sync engine's last-write-wins
-- comparison sees a real timestamp on every server-side write.
drop trigger if exists body_measurements_set_updated_at on public.body_measurements;
create trigger body_measurements_set_updated_at
  before update on public.body_measurements
  for each row execute function public.set_updated_at ();
