-- Localized daily-reminder support.
--
-- The original cron blasted every opted-in user at 18:00 UTC. That's
-- late afternoon in Europe (the target user base at launch), but
-- it's 02:00 in Asia and 13:00 in Pacific US — out of step with
-- "log your dinner" in either direction.
--
-- The 0013 migration already added a nullable `timezone` column;
-- we add two more pieces here:
--
--   1. `reminder_hour` — the local hour the user wants the nudge.
--      0-23 (smallint with CHECK constraint). Default 18 keeps the
--      historical UX for accounts created before this migration.
--
--   2. `last_reminder_sent_date` — local-anchored YYYY-MM-DD of the
--      most recent send. The hourly cron uses this for idempotency:
--      even if the user changes their reminder_hour mid-day, they
--      get at most one reminder per local day. Stored as DATE
--      rather than TIMESTAMPTZ so the comparison "did we already
--      send today (their time)?" is a plain equality check.

alter table public.notification_preferences
  add column if not exists reminder_hour smallint not null default 18,
  add column if not exists last_reminder_sent_date date;

-- CHECK constraint added separately so re-running the migration on
-- a database that already has the column (but not the constraint)
-- still applies it. We test for existence via pg_constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'notification_preferences_reminder_hour_check'
  ) then
    alter table public.notification_preferences
      add constraint notification_preferences_reminder_hour_check
      check (reminder_hour between 0 and 23);
  end if;
end$$;

-- Migration UX note for the maintainer: existing rows pick up the
-- default 18 automatically thanks to NOT NULL DEFAULT — no UPDATE
-- needed. `last_reminder_sent_date` stays NULL until the next cron
-- tick, which correctly says "we haven't sent yet under the new
-- schema, so the first send will go out today (if their local
-- 18:00 hasn't already passed)."
