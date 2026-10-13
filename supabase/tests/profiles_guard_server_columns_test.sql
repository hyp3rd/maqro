-- Regression + security tests for the profiles server-column guard
-- (`profiles_guard_server_columns`, migration 0068, fixed in 0073).
--
-- End-user requests are simulated the way PostgREST runs them: `set local
-- role authenticated` plus `request.jwt.claims`, which auth.uid() reads, so
-- RLS and the trigger both see a real end user. Run with `supabase test db`;
-- see CONTRIBUTING.md §10.
begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

-- ── Fixtures (as postgres: bypasses RLS and the guard) ──────────────────────
-- newbie:   brand-new account with no profile row — the path 0068 broke.
-- attacker: brand-new account that crafts its first INSERT.
-- member:   existing account whose row already carries server-managed state.
insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'newbie@example.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000002', 'attacker@example.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000003', 'member@example.test', 'authenticated', 'authenticated');

-- Since 0074 sign-up creates every profiles row server-side. The guard's
-- INSERT branch still has to hold for a row that is missing (an account from
-- before the backfill, a row removed by hand), so start these accounts
-- without one.
delete from public.profiles
 where user_id in (
   'a0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-000000000003'
 );

insert into public.profiles (user_id, payload, role, is_premium, stripe_customer_id)
values ('a0000000-0000-4000-8000-000000000003', '{"age": 40}', 'admin', true, 'cus_test_member');

select has_trigger(
  'public', 'profiles', 'profiles_guard_server_columns',
  'profiles carries the server-column guard trigger'
);

-- ── newbie: first push, then edits ──────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;

-- Equivalent of what PostgREST runs for the sync engine's
-- `supabase.from("profiles").upsert({ user_id, payload })`.
select lives_ok(
  $$
    insert into public.profiles (user_id, payload)
    values ('a0000000-0000-4000-8000-000000000001', '{"age": 30}')
    on conflict (user_id) do update
      set user_id = excluded.user_id, payload = excluded.payload
  $$,
  'a new user''s first profile push (upsert) succeeds'
);

select results_eq(
  $$
    select payload, role, is_premium from public.profiles
     where user_id = 'a0000000-0000-4000-8000-000000000001'
  $$,
  $$ values ('{"age": 30}'::jsonb, 'user'::text, false) $$,
  'the new row keeps the client payload and lands with default server state'
);

select results_eq(
  $$
    update public.profiles set payload = '{"age": 31}'
     where user_id = 'a0000000-0000-4000-8000-000000000001'
    returning payload
  $$,
  $$ values ('{"age": 31}'::jsonb) $$,
  'an end user may update their own payload'
);

select throws_ok(
  $$
    update public.profiles set role = 'admin'
     where user_id = 'a0000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'profiles: end users may only modify the payload column',
  'an end user cannot self-grant admin'
);

select throws_ok(
  $$
    update public.profiles set is_premium = true
     where user_id = 'a0000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'profiles: end users may only modify the payload column',
  'an end user cannot self-grant premium'
);

-- ── attacker: crafted first INSERT ──────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '{"sub": "a0000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$
    insert into public.profiles (user_id, payload, role, is_premium, stripe_subscription_id)
    values ('a0000000-0000-4000-8000-000000000002', '{}', 'admin', true, 'sub_forged')
  $$,
  'a crafted first insert is accepted'
);

select results_eq(
  $$
    select role, is_premium, stripe_subscription_id from public.profiles
     where user_id = 'a0000000-0000-4000-8000-000000000002'
  $$,
  $$ values ('user'::text, false, null::text) $$,
  'a crafted first insert cannot seed admin, premium, or billing state'
);

-- ── member: upsert onto an existing row (local server token lost) ──────────
-- BEFORE INSERT fires before conflict detection, so the guard resets the
-- proposed row; DO UPDATE must still move only the payload.
reset role;
select set_config('request.jwt.claims', '{"sub": "a0000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$
    insert into public.profiles (user_id, payload)
    values ('a0000000-0000-4000-8000-000000000003', '{"age": 41}')
    on conflict (user_id) do update
      set user_id = excluded.user_id, payload = excluded.payload
  $$,
  'an existing user''s upsert succeeds'
);

select results_eq(
  $$
    select payload, role, is_premium, stripe_customer_id from public.profiles
     where user_id = 'a0000000-0000-4000-8000-000000000003'
  $$,
  $$ values ('{"age": 41}'::jsonb, 'admin'::text, true, 'cus_test_member'::text) $$,
  'an upsert onto an existing row moves only the payload'
);

-- ── service role: trusted writers are untouched ─────────────────────────────
reset role;
set local role service_role;

select results_eq(
  $$
    update public.profiles set is_premium = true
     where user_id = 'a0000000-0000-4000-8000-000000000001'
    returning is_premium
  $$,
  $$ values (true) $$,
  'the service role still writes server-managed columns'
);

-- ── Sweep: every server-managed column is reset on an end-user INSERT ──────
-- The guard's INSERT branch is an explicit reset list (UPDATEs are covered
-- generically by its jsonb diff). Derive the server-managed set from the
-- catalog — every column except the client-writable user_id / payload and the
-- DB-managed updated_at — and, one column at a time, have a fresh end user
-- INSERT a non-default value. Each must land equal to what a plain
-- (user_id, payload) INSERT gets. A new column left off the reset list fails
-- here; a reset naming a column that doesn't exist fails every INSERT.
reset role;

create temp table guard_sweep (
  column_name text primary key,
  tampered text,
  outcome text not null
) on commit drop;

do $$
declare
  baseline_id constant uuid := 'a0000000-0000-4000-8000-0000000000b0';
  baseline jsonb;
  col record;
  probe_id uuid;
  tampered text;
  landed jsonb;
begin
  insert into auth.users (id, email, aud, role)
  values (baseline_id, 'baseline@example.test', 'authenticated', 'authenticated');
  -- Drop the row sign-up created (0074) so the INSERT below takes the guard's
  -- INSERT branch.
  delete from public.profiles where user_id = baseline_id;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', baseline_id, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.profiles (user_id, payload) values (baseline_id, '{}');
    reset role;
  exception when others then
    -- The aborted subtransaction also reverts the role switch.
    insert into guard_sweep values ('(baseline)', null, format('insert failed: %s %s', sqlstate, sqlerrm));
    return;
  end;
  select to_jsonb(p) into baseline from public.profiles p where p.user_id = baseline_id;

  for col in
    select a.attname::text as name, format_type(a.atttypid, a.atttypmod) as type
      from pg_attribute a
     where a.attrelid = 'public.profiles'::regclass
       and a.attnum > 0
       and not a.attisdropped
       and a.attname not in ('user_id', 'payload', 'updated_at')
     order by a.attnum
  loop
    tampered := case
      when col.type = 'boolean'
        then (not coalesce((baseline ->> col.name)::boolean, false))::text
      when col.type = 'text'
        then 'admin'
      when col.type in ('timestamp with time zone', 'timestamp without time zone', 'date')
        then '2000-01-01'
      when col.type in ('smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision')
        then (coalesce((baseline ->> col.name)::numeric, 0) + 1)::text
      when col.type in ('json', 'jsonb')
        then '{"tampered": true}'
      when col.type = 'uuid'
        then gen_random_uuid()::text
    end;
    if tampered is null then
      raise exception 'profiles guard sweep: no tampered value for column % of type % — extend this test',
        col.name, col.type;
    end if;

    probe_id := gen_random_uuid();
    insert into auth.users (id, email, aud, role)
    values (probe_id, probe_id::text || '@example.test', 'authenticated', 'authenticated');
    delete from public.profiles where user_id = probe_id;

    begin
      perform set_config('request.jwt.claims', json_build_object('sub', probe_id, 'role', 'authenticated')::text, true);
      set local role authenticated;
      execute format('insert into public.profiles (user_id, payload, %I) values ($1, ''{}'', $2::%s)', col.name, col.type)
        using probe_id, tampered;
      reset role;
    exception when others then
      insert into guard_sweep values (col.name, tampered, format('insert failed: %s %s', sqlstate, sqlerrm));
      continue;
    end;

    select to_jsonb(p) -> col.name into landed from public.profiles p where p.user_id = probe_id;
    insert into guard_sweep values (
      col.name,
      tampered,
      case
        when landed is not distinct from baseline -> col.name then 'reset'
        else format('kept %s (default %s)', landed, baseline -> col.name)
      end
    );
  end loop;
end
$$;

select is_empty(
  $$ select column_name, tampered, outcome from guard_sweep where outcome <> 'reset' $$,
  'every server-managed profiles column is reset on an end-user INSERT'
);

select ok(
  (select count(*) from guard_sweep
    where outcome = 'reset'
      and column_name in ('role', 'is_premium', 'stripe_customer_id', 'backup_email')) = 4,
  'the sweep covered the privilege, billing, and recovery columns'
);

select * from finish();
rollback;
