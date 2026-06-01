-- Aggregate-only onboarding funnel counters.
--
-- Privacy: this table stores ONE row per (day, step, action) with an
-- integer count. There is NO user_id, NO IP, NO session token, NO
-- timestamp finer than the date. It is mathematically impossible to
-- recover an individual user's behaviour from these rows; the privacy
-- policy promise of "no analytics, telemetry, or usage tracking" still
-- holds because there is nothing per-user to track.
--
-- The reason we keep it server-side at all (rather than just looking at
-- logs) is so the admin funnel view doesn't have to scrape stdout to
-- answer "where did users drop off this week?".
--
-- Schema:
--   day    — the UTC date the event happened on. Daily roll-up is the
--            finest granularity we care about; finer would be a
--            privacy regression for no analytical win.
--   step   — 0-indexed step in the wizard (0=welcome, 1=basics,
--            2=activity, 3=diet). Smallint because the wizard isn't
--            going to grow past a handful of steps.
--   action — discriminator across the three signals we care about:
--              'enter'  — user landed on this step (the funnel signal)
--              'skip'   — user dismissed the wizard from this step
--              'finish' — user completed the wizard
--            'next'/'back' aren't recorded; they're derivable from
--            successive 'enter' events and would just inflate the
--            row count.
--   count  — monotonically incremented by the increment RPC below.

create table if not exists public.onboarding_step_counters (
  day date not null default current_date,
  step smallint not null check (step >= 0 and step < 64),
  action text not null check (action in ('enter', 'skip', 'finish')),
  count bigint not null default 0,
  primary key (day, step, action)
);

comment on table public.onboarding_step_counters is
  'Daily aggregate funnel counters for the onboarding wizard. No PII, no per-user rows. See migration 0042 for the privacy rationale.';

create index if not exists onboarding_step_counters_day_idx
  on public.onboarding_step_counters (day desc);

alter table public.onboarding_step_counters enable row level security;
-- No policies. Reads happen via service-role only (admin funnel page).
-- Writes happen via the SECURITY DEFINER function below, which is the
-- only path the public route uses to bump a counter.

/* SECURITY DEFINER bump-the-counter helper. The /api/onboarding/events
 * route is anonymous (the wizard runs before sign-in), so we need a
 * privileged path to write while keeping anon clients out of the table
 * directly. The function does an UPSERT keyed on (day, step, action)
 * and increments by 1. INSERT-then-UPDATE under concurrency is handled
 * by ON CONFLICT.
 *
 * The function validates `action` against the same allowlist as the
 * CHECK constraint so a bad payload returns a useful error instead of a
 * raw constraint violation. */
create or replace function public.bump_onboarding_counter(
  p_step smallint,
  p_action text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_action not in ('enter', 'skip', 'finish') then
    raise exception 'invalid action: %', p_action using errcode = '22023';
  end if;
  if p_step < 0 or p_step >= 64 then
    raise exception 'invalid step: %', p_step using errcode = '22023';
  end if;
  insert into public.onboarding_step_counters (day, step, action, count)
    values (current_date, p_step, p_action, 1)
    on conflict (day, step, action) do update
    set count = public.onboarding_step_counters.count + 1;
end;
$$;

revoke all on function public.bump_onboarding_counter(smallint, text) from public;
grant execute on function public.bump_onboarding_counter(smallint, text) to anon, authenticated, service_role;
