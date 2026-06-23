-- Supplement logging (Pro): a reusable supplement library + a date-keyed intake
-- log that feeds the micronutrient totals, plus an opt-in reminder schedule.
-- Mirrors the existing local-first sync stores: `supplements` is id-keyed like
-- `meal_schedules` (0061); `supplement_intake` is date-keyed last-write-wins like
-- `water_intake` (0056). The IDB side is db.ts v21.

-- ── Library: one row per supplement definition ──────────────────────────────
create table if not exists public.supplements (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  dose_label text not null,
  -- Absolute micronutrient amounts provided per dose (canonical units), keyed
  -- by the same nutrient keys as food micros. { "vitaminD": 25, "iron": 8 }.
  micros jsonb not null,
  -- Optional reminder schedule { reminderTimes: int[], daysOfWeek: int[] }.
  schedule jsonb,
  notes text,
  sort_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists supplements_user_idx on public.supplements (user_id);

alter table public.supplements enable row level security;

drop policy if exists "supplements_owner_all" on public.supplements;
create policy "supplements_owner_all" on public.supplements for all using (
  user_id = auth.uid ()
)
with
  check (user_id = auth.uid ());

drop trigger if exists supplements_set_updated_at on public.supplements;
create trigger supplements_set_updated_at before update on public.supplements for each row
execute function public.set_updated_at ();

-- ── Intake: one row per (user, day) — what was actually taken ────────────────
create table if not exists public.supplement_intake (
  user_id uuid not null references auth.users (id) on delete cascade,
  date text not null check (date ~ '^\d{4}-\d{2}-\d{2}$'),
  -- Array of { supplementId, doses } taken that day. Feeds the micro totals.
  taken jsonb not null,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create index if not exists supplement_intake_user_idx on public.supplement_intake (user_id);

alter table public.supplement_intake enable row level security;

drop policy if exists "supplement_intake_owner_all" on public.supplement_intake;
create policy "supplement_intake_owner_all" on public.supplement_intake for all using (
  user_id = auth.uid ()
)
with
  check (user_id = auth.uid ());

drop trigger if exists supplement_intake_set_updated_at on public.supplement_intake;
create trigger supplement_intake_set_updated_at before update on public.supplement_intake for each row
execute function public.set_updated_at ();

-- Realtime: emit change events so intake stays live across devices (mirrors
-- water_intake; the client subscribes in lib/sync/realtime.ts).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'supplement_intake'
  ) then
    alter publication supabase_realtime add table public.supplement_intake;
  end if;
end $$;

-- ── Reminders opt-in ────────────────────────────────────────────────────────
alter table public.notification_preferences
add column if not exists supplement_reminders boolean not null default false;

-- Dedup ledger for the hourly supplement-reminder cron: one row per
-- (user, supplement, local day, hour) actually sent, so multiple hourly fires
-- on the same local day send each scheduled time at most once. Service-role
-- only (RLS on, no policies) — the client never reads it. The cron prunes rows
-- older than yesterday at the start of each run.
create table if not exists public.supplement_reminder_sends (
  user_id uuid not null references auth.users (id) on delete cascade,
  supplement_id uuid not null references public.supplements (id) on delete cascade,
  local_date text not null check (local_date ~ '^\d{4}-\d{2}-\d{2}$'),
  sent_hour smallint not null check (sent_hour >= 0 and sent_hour <= 23),
  created_at timestamptz not null default now(),
  primary key (user_id, supplement_id, local_date, sent_hour)
);

alter table public.supplement_reminder_sends enable row level security;
