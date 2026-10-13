-- Every account gets a public.profiles row at sign-up (migration 0074), and
-- the writers that rely on it work against that placeholder row.
--
-- Sign-up is simulated by an INSERT into auth.users (the test role cannot
-- assume GoTrue's `supabase_auth_admin`; the trigger runs as its SECURITY
-- DEFINER owner either way). End users are simulated as in
-- profiles_guard_server_columns_test.sql (`set local role authenticated` plus
-- `request.jwt.claims`). Run with `supabase test db`; see CONTRIBUTING.md §10.
begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

select has_trigger(
  'auth', 'users', 'on_auth_user_created_create_profile',
  'auth.users carries the create-profile trigger'
);

select is(
  (select prosecdef from pg_proc where oid = 'public.create_profile_for_new_user()'::regprocedure),
  true,
  'the trigger function is SECURITY DEFINER'
);

select ok(
  (select proconfig @> array['search_path=""']
     from pg_proc where oid = 'public.create_profile_for_new_user()'::regprocedure),
  'the trigger function pins an empty search_path'
);

select ok(
  not has_function_privilege('anon', 'public.create_profile_for_new_user()', 'execute')
  and not has_function_privilege('authenticated', 'public.create_profile_for_new_user()', 'execute'),
  'end-user roles cannot execute the trigger function'
);

-- ── sign-up creates the placeholder row ─────────────────────────────────────
insert into auth.users (id, email, aud, role) values
  ('b0000000-0000-4000-8000-000000000001', 'signup@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-000000000002', 'subscriber@example.test', 'authenticated', 'authenticated');

select results_eq(
  $$
    select payload, role, is_premium, traced, stripe_customer_id, subscription_status
      from public.profiles
     where user_id = 'b0000000-0000-4000-8000-000000000001'
  $$,
  $$ values ('{}'::jsonb, 'user'::text, false, false, null::text, null::text) $$,
  'sign-up creates a profiles row with an empty payload and default server state'
);

-- ── the end user's first push lands on the placeholder ──────────────────────
select set_config('request.jwt.claims', '{"sub": "b0000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;

select results_eq(
  $$ select payload from public.profiles where user_id = 'b0000000-0000-4000-8000-000000000001' $$,
  $$ values ('{}'::jsonb) $$,
  'the end user can read their own placeholder row'
);

-- What PostgREST runs for the sync engine's
-- `supabase.from("profiles").upsert({ user_id, payload })`.
select lives_ok(
  $$
    insert into public.profiles (user_id, payload)
    values ('b0000000-0000-4000-8000-000000000001', '{"age": 30}')
    on conflict (user_id) do update
      set user_id = excluded.user_id, payload = excluded.payload
  $$,
  'the first profile push (upsert) succeeds onto the placeholder'
);

select results_eq(
  $$ select payload, role, is_premium from public.profiles where user_id = 'b0000000-0000-4000-8000-000000000001' $$,
  $$ values ('{"age": 30}'::jsonb, 'user'::text, false) $$,
  'the push replaces the placeholder payload and nothing else'
);

reset role;

-- ── server writers (service role) against the placeholder ───────────────────
set local role service_role;

-- The old checkout write: a partial upsert. NOT NULL is checked on the
-- proposed row before ON CONFLICT is resolved, so it fails even though the
-- row exists — why checkout now uses a checked UPDATE.
select throws_ok(
  $$
    insert into public.profiles (user_id, stripe_customer_id)
    values ('b0000000-0000-4000-8000-000000000002', 'cus_test_partial')
    on conflict (user_id) do update set stripe_customer_id = excluded.stripe_customer_id
  $$,
  '23502',
  null,
  'a payload-less upsert fails even when the row exists'
);

select results_eq(
  $$
    update public.profiles set stripe_customer_id = 'cus_test_sub'
     where user_id = 'b0000000-0000-4000-8000-000000000002'
    returning user_id
  $$,
  $$ values ('b0000000-0000-4000-8000-000000000002'::uuid) $$,
  'checkout''s checked UPDATE of the customer id matches exactly one row'
);

select results_eq(
  $$
    update public.profiles
       set stripe_subscription_id = 'sub_test', subscription_status = 'trialing', is_premium = true
     where user_id = 'b0000000-0000-4000-8000-000000000002'
    returning user_id
  $$,
  $$ values ('b0000000-0000-4000-8000-000000000002'::uuid) $$,
  'the checkout webhook''s entitlement UPDATE matches exactly one row'
);

select results_eq(
  $$
    update public.profiles set role = 'admin'
     where user_id = 'b0000000-0000-4000-8000-000000000002'
    returning role
  $$,
  $$ values ('admin'::text) $$,
  'the admin role change is a checked UPDATE that matches the row'
);

select results_eq(
  $$
    select payload, stripe_customer_id, is_premium from public.profiles
     where user_id = 'b0000000-0000-4000-8000-000000000002'
  $$,
  $$ values ('{}'::jsonb, 'cus_test_sub'::text, true) $$,
  'server writes keep the placeholder payload intact'
);

reset role;

-- ── invariant: no account without a row ────────────────────────────────────
select is_empty(
  $$
    select u.id from auth.users u
     where not exists (select 1 from public.profiles p where p.user_id = u.id)
  $$,
  'every account has a profiles row'
);

select * from finish();
rollback;
