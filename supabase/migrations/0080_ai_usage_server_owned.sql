-- Make the AI usage counter (`public.ai_usage_monthly`) server-owned, and
-- debit it atomically.
--
-- Two defects, one root cause: the counter was written by end users.
--
-- 1. Users could reset their own quota. 0011 gave owners a FOR ALL policy
--    (`user_id = auth.uid()`) because the app metered through the caller's
--    session client, so `authenticated` held INSERT/UPDATE/DELETE on the
--    table. With the publishable key and their own JWT, any user could send
--
--        PATCH  /rest/v1/ai_usage_monthly?user_id=eq.<self>  {"count": -100000}
--        DELETE /rest/v1/ai_usage_monthly?user_id=eq.<self>
--
--    and every AI route then read a count under the cap: unmetered Sonnet /
--    Haiku spend for a free or Plus account (SECURITY.md: "AI cost-cap
--    bypass"). 0068 closed the same class of hole for `profiles` only; a
--    trigger guard cannot work here, because the legitimate writer was the
--    same `authenticated` role.
--
-- 2. The debit was a read followed by an absolute write
--    (`upsert({ count: used + 1 })`, i.e. ON CONFLICT DO UPDATE SET
--    count = EXCLUDED.count). N concurrent calls all read the same `used`,
--    all passed the cap check and all wrote the same value, so a burst was
--    charged once; a failed read (`used` fell back to 0) wiped the month.
--
-- Fix:
--   - The owner policy becomes SELECT-only (Settings shows "N of M used"
--     through the session client) and INSERT/UPDATE/DELETE/TRUNCATE are
--     revoked from anon and authenticated, so the table is read-only to end
--     users regardless of policies. The admin override
--     (app/api/admin/users/[id]/usage) and these functions are the only
--     writers; both run as the service role / table owner and keep working.
--   - `consume_ai_credit` checks and debits in ONE statement:
--     INSERT ... ON CONFLICT DO UPDATE ... WHERE count < cap. Postgres locks
--     the conflicting row and re-evaluates the WHERE against the latest
--     committed version, so concurrent calls serialize on the row and the
--     counter can never pass the cap. `granted = false` means "refuse".
--   - `refund_ai_credit` gives one credit back (floored at 0) for the one
--     route that debits before a model call whose failure it does not bill
--     (recipes/import-from-url falls back to JSON-LD).
--   - EXECUTE on both is granted to service_role only. The cap is an input,
--     so an end user able to call `consume_ai_credit` could pass a cap of
--     their choosing; `refund_ai_credit` would hand out free credits. The app
--     calls them with the service-role client after authenticating the user
--     (lib/billing/usage.ts). They are SECURITY DEFINER so the write path is
--     the function itself, independent of any role's table grants; the
--     EXECUTE grant is the only gate, and end users do not hold it.
--   - `count >= 0` is enforced. Any row already driven negative through the
--     hole above is clamped to 0 first so the constraint can be added (a
--     negative count only exists if someone tampered with it).
--
-- Rollout: migrations apply BEFORE the new app is live. While the previous
-- app version is still serving, its session-client upsert now fails with
-- 42501. That version logs the failure and allows the call (it failed open),
-- so for the length of the deploy window under-cap calls are not counted.
-- Its cap check still reads the counter (owner SELECT is kept), so users
-- already at their cap stay blocked, and nobody can reset the counter any
-- more. The new app debits through `consume_ai_credit` and fails CLOSED
-- (503) when metering is unavailable. Rolling the app back to a pre-0080
-- version while this migration stays would reopen that fail-open window
-- indefinitely, so fix forward instead.
--
-- Regression coverage: supabase/tests/ai_usage_metering_test.sql.

-- ── Constraint: the counter is never negative ──────────────────────────────
update public.ai_usage_monthly set count = 0 where count < 0;

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.ai_usage_monthly'::regclass
       and conname = 'ai_usage_monthly_count_nonnegative'
  ) then
    alter table public.ai_usage_monthly
      add constraint ai_usage_monthly_count_nonnegative check (count >= 0);
  end if;
end;
$$;

-- ── End users: read their own row, write nothing ───────────────────────────
drop policy if exists "ai_usage_owner_all" on public.ai_usage_monthly;
drop policy if exists "ai_usage_owner_read" on public.ai_usage_monthly;

create policy "ai_usage_owner_read"
  on public.ai_usage_monthly
  for select
  using (user_id = auth.uid ());

revoke insert, update, delete, truncate on public.ai_usage_monthly
  from public, anon, authenticated;

-- ── Atomic check-and-debit ─────────────────────────────────────────────────
create or replace function public.consume_ai_credit(
  p_user_id uuid,
  p_period_start date,
  p_cap integer
)
returns table (granted boolean, used integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- A null cap must never be read as "unmetered": unmetered tiers skip this
  -- function entirely, so a null here is a caller bug.
  if p_user_id is null or p_period_start is null or p_cap is null then
    raise exception 'consume_ai_credit: user, period and cap are required'
      using errcode = '22004'; -- null_value_not_allowed
  end if;

  -- `where p_cap > 0` keeps a zero cap from creating a row at 1; the
  -- conflict branch's WHERE refuses once the row has reached the cap.
  -- RETURNING yields a row only when a credit was actually debited.
  insert into public.ai_usage_monthly as u (user_id, period_start, count)
  select p_user_id, p_period_start, 1
   where p_cap > 0
  on conflict (user_id, period_start) do update
     set count = u.count + 1
   where u.count < p_cap
  returning u.count into v_count;

  if v_count is not null then
    return query select true, v_count;
    return;
  end if;

  select u.count
    into v_count
    from public.ai_usage_monthly as u
   where u.user_id = p_user_id
     and u.period_start = p_period_start;

  return query select false, coalesce(v_count, 0);
end;
$$;

comment on function public.consume_ai_credit(uuid, date, integer) is
  'Debit one AI credit for (user, month) if the count is under p_cap. '
  'granted = false means refuse the call. Service role only.';

revoke execute on function public.consume_ai_credit(uuid, date, integer)
  from public, anon, authenticated;
grant execute on function public.consume_ai_credit(uuid, date, integer)
  to service_role;

-- ── Refund one credit (debited call produced nothing billable) ─────────────
create or replace function public.refund_ai_credit(
  p_user_id uuid,
  p_period_start date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.ai_usage_monthly as u
     set count = u.count - 1
   where u.user_id = p_user_id
     and u.period_start = p_period_start
     and u.count > 0
  returning u.count into v_count;

  if v_count is null then
    select u.count
      into v_count
      from public.ai_usage_monthly as u
     where u.user_id = p_user_id
       and u.period_start = p_period_start;
  end if;

  -- null when the month has no row (nothing to refund).
  return v_count;
end;
$$;

comment on function public.refund_ai_credit(uuid, date) is
  'Give back one AI credit for (user, month), floored at 0. Returns the new '
  'count, or null when the month has no row. Service role only.';

revoke execute on function public.refund_ai_credit(uuid, date)
  from public, anon, authenticated;
grant execute on function public.refund_ai_credit(uuid, date)
  to service_role;
