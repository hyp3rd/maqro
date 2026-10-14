-- Security + behaviour tests for the server-owned AI usage counter
-- (`public.ai_usage_monthly`, migration 0080).
--
-- End-user requests are simulated the way PostgREST runs them: `set local
-- role authenticated` (or anon) plus `request.jwt.claims`, which auth.uid()
-- reads. The metering server path is simulated with `set local role
-- service_role`. Run with `supabase test db`; see CONTRIBUTING.md §10.
begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

-- ── Fixtures (as postgres: bypasses RLS) ────────────────────────────────────
-- owner: a free user with a counter row this month.
-- other: a second user, to check owners only ever see their own row.
-- fresh: a user with no counter row yet (first metered call of the month).
insert into auth.users (id, email, aud, role) values
  ('b0000000-0000-4000-8000-000000000001', 'owner@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-000000000002', 'other@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-000000000003', 'fresh@example.test', 'authenticated', 'authenticated');

insert into public.ai_usage_monthly (user_id, period_start, count) values
  ('b0000000-0000-4000-8000-000000000001', '2026-10-01', 24),
  ('b0000000-0000-4000-8000-000000000002', '2026-10-01', 3);

-- ── Schema guarantees ───────────────────────────────────────────────────────
select col_has_check(
  'public', 'ai_usage_monthly', 'count',
  'ai_usage_monthly.count carries a CHECK constraint'
);

select throws_ok(
  $$
    update public.ai_usage_monthly set count = -1
     where user_id = 'b0000000-0000-4000-8000-000000000002'
  $$,
  '23514',
  null,
  'a negative count is rejected even for privileged writers'
);

select policies_are(
  'public', 'ai_usage_monthly',
  array['ai_usage_owner_read'],
  'the only policy on ai_usage_monthly is the owner read policy'
);

select is(
  (select cmd from pg_policies
    where schemaname = 'public' and tablename = 'ai_usage_monthly'
      and policyname = 'ai_usage_owner_read'),
  'SELECT',
  'the owner policy is SELECT-only'
);

select ok(
  (select prosecdef from pg_proc
    where oid = 'public.consume_ai_credit(uuid, date, integer)'::regprocedure),
  'consume_ai_credit is SECURITY DEFINER'
);

select ok(
  (select proconfig @> array['search_path=""'] from pg_proc
    where oid = 'public.consume_ai_credit(uuid, date, integer)'::regprocedure),
  'consume_ai_credit pins an empty search_path'
);

select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc
    where oid = 'public.refund_ai_credit(uuid, date)'::regprocedure),
  'refund_ai_credit is SECURITY DEFINER with an empty search_path'
);

-- Only the service role may move the counter. If authenticated could call
-- these, any user could pass their own cap (consume) or claw credits back
-- (refund) through /rest/v1/rpc.
select ok(
  has_function_privilege('service_role', 'public.consume_ai_credit(uuid, date, integer)', 'execute')
  and has_function_privilege('service_role', 'public.refund_ai_credit(uuid, date)', 'execute'),
  'service_role can execute the metering functions'
);

select ok(
  not has_function_privilege('authenticated', 'public.consume_ai_credit(uuid, date, integer)', 'execute')
  and not has_function_privilege('anon', 'public.consume_ai_credit(uuid, date, integer)', 'execute'),
  'anon and authenticated cannot execute consume_ai_credit'
);

select ok(
  not has_function_privilege('authenticated', 'public.refund_ai_credit(uuid, date)', 'execute')
  and not has_function_privilege('anon', 'public.refund_ai_credit(uuid, date)', 'execute'),
  'anon and authenticated cannot execute refund_ai_credit'
);

-- ── End user: read-only access to their own row ────────────────────────────
select set_config('request.jwt.claims', '{"sub": "b0000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;

select results_eq(
  $$ select user_id, count from public.ai_usage_monthly $$,
  $$ values ('b0000000-0000-4000-8000-000000000001'::uuid, 24) $$,
  'an end user reads only their own counter row'
);

-- The attacks from the finding: reset, lower, delete, or forge the counter
-- with the user's own JWT straight through PostgREST.
select throws_ok(
  $$
    update public.ai_usage_monthly set count = 0
     where user_id = 'b0000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'an end user cannot reset their own counter'
);

select throws_ok(
  $$
    update public.ai_usage_monthly set count = -100000
     where user_id = 'b0000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'an end user cannot write a negative counter'
);

select throws_ok(
  $$
    delete from public.ai_usage_monthly
     where user_id = 'b0000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'an end user cannot delete their own counter row'
);

select throws_ok(
  $$
    insert into public.ai_usage_monthly (user_id, period_start, count)
    values ('b0000000-0000-4000-8000-000000000001', '2026-11-01', 0)
  $$,
  '42501',
  null,
  'an end user cannot insert a counter row'
);

-- What the pre-0080 app sent with the session client (supabase-js upsert).
select throws_ok(
  $$
    insert into public.ai_usage_monthly (user_id, period_start, count)
    values ('b0000000-0000-4000-8000-000000000001', '2026-10-01', 0)
    on conflict (user_id, period_start) do update set count = excluded.count
  $$,
  '42501',
  null,
  'an end user cannot upsert their own counter'
);

select throws_ok(
  $$ truncate public.ai_usage_monthly $$,
  '42501',
  null,
  'an end user cannot truncate the counter table'
);

select throws_ok(
  $$ select * from public.consume_ai_credit('b0000000-0000-4000-8000-000000000001', '2026-10-01', 1000000) $$,
  '42501',
  null,
  'an end user cannot call consume_ai_credit with a cap of their choosing'
);

select throws_ok(
  $$ select public.refund_ai_credit('b0000000-0000-4000-8000-000000000001', '2026-10-01') $$,
  '42501',
  null,
  'an end user cannot refund themselves credits'
);

reset role;

select results_eq(
  $$ select count from public.ai_usage_monthly
      where user_id = 'b0000000-0000-4000-8000-000000000001' $$,
  $$ values (24) $$,
  'the end-user attempts left the counter untouched'
);

-- anon: no rows visible, no writes.
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;

select is_empty(
  $$ select 1 from public.ai_usage_monthly $$,
  'anon sees no counter rows'
);

select throws_ok(
  $$
    delete from public.ai_usage_monthly
     where user_id = 'b0000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'anon cannot delete counter rows'
);

reset role;

-- ── Server path: atomic check-and-debit ─────────────────────────────────────
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;

select results_eq(
  $$ select granted, used from public.consume_ai_credit('b0000000-0000-4000-8000-000000000003', '2026-10-01', 25) $$,
  $$ values (true, 1) $$,
  'the first metered call of the month creates the row at 1'
);

select results_eq(
  $$ select granted, used from public.consume_ai_credit('b0000000-0000-4000-8000-000000000001', '2026-10-01', 25) $$,
  $$ values (true, 25) $$,
  'a call under the cap is granted and debits exactly one credit'
);

select results_eq(
  $$ select granted, used from public.consume_ai_credit('b0000000-0000-4000-8000-000000000001', '2026-10-01', 25) $$,
  $$ values (false, 25) $$,
  'a call at the cap is refused and reports the current count'
);

select results_eq(
  $$ select granted, used from public.consume_ai_credit('b0000000-0000-4000-8000-000000000003', '2026-10-01', 0) $$,
  $$ values (false, 1) $$,
  'a zero cap refuses without debiting'
);

select results_eq(
  $$ select granted, used from public.consume_ai_credit('b0000000-0000-4000-8000-000000000002', '2026-11-01', 0) $$,
  $$ values (false, 0) $$,
  'a zero cap never creates a row'
);

-- Refund: undo a debit whose AI call produced nothing, floored at zero.
select is(
  public.refund_ai_credit('b0000000-0000-4000-8000-000000000001', '2026-10-01'),
  24,
  'a refund returns one credit'
);

select is(
  public.refund_ai_credit('b0000000-0000-4000-8000-000000000002', '2026-11-01'),
  null,
  'a refund for a month with no row is a no-op'
);

select throws_ok(
  $$ select * from public.consume_ai_credit('b0000000-0000-4000-8000-000000000001', '2026-10-01', null) $$,
  '22004',
  null,
  'a null cap is rejected rather than treated as unmetered'
);

reset role;

select * from finish();
rollback;
