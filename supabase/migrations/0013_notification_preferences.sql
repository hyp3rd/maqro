-- Per-user opt-in flags for transactional emails. One row per user.
-- Absent row = absent prefs = no emails (defensive default: never
-- surprise-email someone who never asked).
--
-- v1 surface area: two booleans. Daily reminder + weekly recap. A
-- timezone column is reserved for the daily-reminder cron — when
-- the cron grows from "fire at one UTC hour" to "fire at 8pm in the
-- user's local zone" it'll group by this field.

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- "Hey, you haven't logged anything today" email. Cron fires once
  -- daily; users with this true AND no foods logged today get the
  -- nudge. Inactive users can opt out without leaving the app.
  daily_reminder boolean not null default false,
  -- "Your week in macros" digest. Cron fires Mondays.
  weekly_recap boolean not null default false,
  -- Reserved for future per-user time-of-day localization of the
  -- daily reminder. NULL means "use the cron's default UTC hour".
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

-- Owner-only RLS. The cron route reads ACROSS users via the
-- service-role client, which bypasses RLS — this policy is purely
-- for the user's own read/write from the Settings panel.
drop policy if exists "notification_preferences_owner_all"
  on public.notification_preferences;
create policy "notification_preferences_owner_all"
  on public.notification_preferences
  for all
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

drop trigger if exists notification_preferences_set_updated_at
  on public.notification_preferences;
create trigger notification_preferences_set_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at ();
