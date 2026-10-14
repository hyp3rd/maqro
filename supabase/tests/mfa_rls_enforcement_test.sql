-- Second-factor enforcement in RLS (migration 0079).
--
-- An MFA-enrolled user's session must prove the second factor (aal2, or a
-- passkey sign-in) before RLS lets it touch any user data; users without a
-- verified factor are unaffected. End-user requests are simulated the way
-- PostgREST / Storage run them: `set local role authenticated` plus
-- `request.jwt.claims`, which auth.uid() and auth.jwt() read. Run with
-- `supabase test db`; see CONTRIBUTING.md §10.
begin;

create extension if not exists pgtap with schema extensions;

select plan(32);

-- ── Fixtures (as postgres: bypasses RLS) ────────────────────────────────────
-- enrolled: verified TOTP factor, owns data in several tables + storage.
-- plain:    no factor at all.
-- pending:  only an UNVERIFIED factor (mid-enrollment) — nothing to prove yet.
-- admin:    admin with a verified factor; can read admin tables at aal2 only.
insert into auth.users (id, email, aud, role) values
  ('b0000000-0000-4000-8000-000000000001', 'enrolled@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-000000000002', 'plain@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-000000000003', 'pending@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-000000000004', 'admin@example.test', 'authenticated', 'authenticated');

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'phone app', 'totp', 'verified', now(), now()),
  ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003', 'half done', 'totp', 'unverified', now(), now()),
  ('c0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000004', 'admin app', 'totp', 'verified', now(), now());

insert into public.profiles (user_id, payload, role) values
  ('b0000000-0000-4000-8000-000000000001', '{"age": 40}', 'user'),
  ('b0000000-0000-4000-8000-000000000002', '{"age": 30}', 'user'),
  ('b0000000-0000-4000-8000-000000000004', '{"age": 50}', 'admin');

insert into public.daily_logs (user_id, date, meals) values
  ('b0000000-0000-4000-8000-000000000001', '2026-10-01', '[]'),
  ('b0000000-0000-4000-8000-000000000002', '2026-10-01', '[]'),
  ('b0000000-0000-4000-8000-000000000003', '2026-10-01', '[]');

insert into public.weight_history (user_id, date, kg) values
  ('b0000000-0000-4000-8000-000000000001', '2026-10-01', 80);

insert into public.recipes (id, user_id, name, ingredients) values
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Soup', '[]');

insert into public.admin_audit_log (admin_user_id, action) values
  ('b0000000-0000-4000-8000-000000000004', 'test.fixture');

insert into storage.objects (bucket_id, name, owner_id) values
  ('captures', 'b0000000-0000-4000-8000-000000000001/photo.jpg', 'b0000000-0000-4000-8000-000000000001');

-- ── enrolled user, aal1 (first factor only): denied everywhere ──────────────
select set_config('request.jwt.claims', '{"sub": "b0000000-0000-4000-8000-000000000001", "role": "authenticated", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1}]}', true);
set local role authenticated;

select ok(not public.session_satisfies_mfa(), 'aal1 + verified factor does not satisfy the rule');
select is_empty($$ select 1 from public.daily_logs $$, 'aal1 enrolled: daily_logs reads come back empty');
select is_empty($$ select 1 from public.profiles $$, 'aal1 enrolled: profiles reads come back empty');
select is_empty($$ select 1 from public.weight_history $$, 'aal1 enrolled: weight_history reads come back empty');
select is_empty($$ select 1 from public.recipes $$, 'aal1 enrolled: own recipes are not readable');
select is_empty($$ select 1 from storage.objects $$, 'aal1 enrolled: own storage objects are not readable');
select throws_ok(
  $$ insert into public.daily_logs (user_id, date, meals)
     values ('b0000000-0000-4000-8000-000000000001', '2026-10-02', '[]') $$,
  '42501', null,
  'aal1 enrolled: inserts are rejected'
);
select is_empty(
  $$ update public.daily_logs set meals = '[1]'
      where user_id = 'b0000000-0000-4000-8000-000000000001' returning 1 $$,
  'aal1 enrolled: updates match no rows'
);
select is_empty(
  $$ delete from public.weight_history
      where user_id = 'b0000000-0000-4000-8000-000000000001' returning 1 $$,
  'aal1 enrolled: deletes match no rows'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('captures', 'b0000000-0000-4000-8000-000000000001/new.jpg', 'b0000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'aal1 enrolled: storage uploads are rejected'
);

reset role;
select results_eq(
  $$ select count(*)::int from public.weight_history
      where user_id = 'b0000000-0000-4000-8000-000000000001' $$,
  $$ values (1) $$,
  'the aal1 delete really left the row in place'
);

-- ── enrolled user, aal1 + a garbage amr claim: still denied ─────────────────
select set_config('request.jwt.claims', '{"sub": "b0000000-0000-4000-8000-000000000001", "role": "authenticated", "aal": "aal1", "amr": "passkey"}', true);
set local role authenticated;
select is_empty($$ select 1 from public.daily_logs $$, 'a non-array amr claim is not a passkey sign-in');
reset role;

-- ── enrolled user, aal2: full access to their own rows ──────────────────────
select set_config('request.jwt.claims', '{"sub": "b0000000-0000-4000-8000-000000000001", "role": "authenticated", "aal": "aal2", "amr": [{"method": "otp", "timestamp": 1}, {"method": "totp", "timestamp": 2}]}', true);
set local role authenticated;

select ok(public.session_satisfies_mfa(), 'aal2 satisfies the rule');
select results_eq(
  $$ select user_id::text from public.daily_logs $$,
  $$ values ('b0000000-0000-4000-8000-000000000001') $$,
  'aal2 enrolled: reads own daily_logs (and only those)'
);
select isnt_empty($$ select 1 from public.profiles $$, 'aal2 enrolled: reads own profile');
select isnt_empty($$ select 1 from storage.objects $$, 'aal2 enrolled: reads own storage objects');
select lives_ok(
  $$ insert into public.daily_logs (user_id, date, meals)
     values ('b0000000-0000-4000-8000-000000000001', '2026-10-02', '[]') $$,
  'aal2 enrolled: inserts succeed'
);
select isnt_empty(
  $$ update public.recipes set name = 'Better soup'
      where id = 'd0000000-0000-4000-8000-000000000001' returning 1 $$,
  'aal2 enrolled: updates succeed'
);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('captures', 'b0000000-0000-4000-8000-000000000001/new.jpg', 'b0000000-0000-4000-8000-000000000001') $$,
  'aal2 enrolled: storage uploads succeed'
);
reset role;

-- ── enrolled user, aal1 passkey sign-in: allowed ────────────────────────────
select set_config('request.jwt.claims', '{"sub": "b0000000-0000-4000-8000-000000000001", "role": "authenticated", "aal": "aal1", "amr": [{"method": "passkey", "timestamp": 1}]}', true);
set local role authenticated;
select ok(public.session_satisfies_mfa(), 'a passkey sign-in satisfies the rule');
select isnt_empty($$ select 1 from public.daily_logs $$, 'passkey session: reads own daily_logs');
reset role;

-- ── plain user (no factor), aal1: unaffected ────────────────────────────────
select set_config('request.jwt.claims', '{"sub": "b0000000-0000-4000-8000-000000000002", "role": "authenticated", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1}]}', true);
set local role authenticated;
select ok(public.session_satisfies_mfa(), 'aal1 without factors satisfies the rule');
select results_eq(
  $$ select user_id::text from public.daily_logs $$,
  $$ values ('b0000000-0000-4000-8000-000000000002') $$,
  'aal1 without factors: reads own daily_logs (and only those)'
);
select lives_ok(
  $$ insert into public.weight_history (user_id, date, kg)
     values ('b0000000-0000-4000-8000-000000000002', '2026-10-01', 70) $$,
  'aal1 without factors: inserts succeed'
);
select lives_ok(
  $$ insert into public.profiles (user_id, payload)
     values ('b0000000-0000-4000-8000-000000000002', '{"age": 31}')
     on conflict (user_id) do update set payload = excluded.payload $$,
  'aal1 without factors: the sync engine''s profile upsert succeeds'
);
reset role;

-- ── mid-enrollment user (unverified factor only), aal1: unaffected ──────────
select set_config('request.jwt.claims', '{"sub": "b0000000-0000-4000-8000-000000000003", "role": "authenticated", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1}]}', true);
set local role authenticated;
select isnt_empty($$ select 1 from public.daily_logs $$, 'an unverified factor does not gate access');
reset role;

-- ── admin with MFA: admin-only tables need aal2 too ─────────────────────────
select set_config('request.jwt.claims', '{"sub": "b0000000-0000-4000-8000-000000000004", "role": "authenticated", "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1}]}', true);
set local role authenticated;
select is_empty($$ select 1 from public.admin_audit_log $$, 'aal1 admin: admin_audit_log is not readable');
reset role;
select set_config('request.jwt.claims', '{"sub": "b0000000-0000-4000-8000-000000000004", "role": "authenticated", "aal": "aal2", "amr": [{"method": "totp", "timestamp": 1}]}', true);
set local role authenticated;
select isnt_empty($$ select 1 from public.admin_audit_log $$, 'aal2 admin: admin_audit_log is readable');
reset role;

-- ── Catalog: every table end users can reach carries the policy ─────────────
-- "Reachable" = RLS on, `authenticated` holds a table privilege, and some
-- PERMISSIVE policy applies to it (to authenticated directly, or to PUBLIC).
-- Exempt only status_probes, which is public data `anon` reads too.
-- storage.objects is checked the same way.
create temporary view mfa_policy_gaps as
  select t.schemaname, t.tablename
    from pg_tables t
   where (t.schemaname = 'public' or (t.schemaname, t.tablename) = ('storage', 'objects'))
     and t.rowsecurity
     and t.tablename not in ('status_probes')
     and (   has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'select')
          or has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'insert')
          or has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'update')
          or has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'delete'))
     and exists (
           select 1 from pg_policies p
            where (p.schemaname, p.tablename) = (t.schemaname, t.tablename)
              and p.permissive = 'PERMISSIVE'
              and p.roles && array['public', 'authenticated']::name[])
     and not exists (
           select 1 from pg_policies p
            where (p.schemaname, p.tablename) = (t.schemaname, t.tablename)
              and p.policyname = 'mfa_second_factor_required'
              and p.permissive = 'RESTRICTIVE'
              and p.cmd = 'ALL'
              and p.roles = array['authenticated']::name[]
              and p.qual like '%session_satisfies_mfa()%'
              and p.with_check like '%session_satisfies_mfa()%');

select is_empty(
  $$ select schemaname || '.' || tablename from mfa_policy_gaps $$,
  'every RLS table end users can reach (and storage.objects) has the restrictive second-factor policy'
);

-- ── The helper itself ───────────────────────────────────────────────────────
select is_definer(
  'public', 'session_satisfies_mfa', array[]::name[],
  'session_satisfies_mfa is SECURITY DEFINER (auth.mfa_factors is not readable by authenticated)'
);
select ok(
  (select proconfig @> array['search_path=""']
     from pg_proc where oid = 'public.session_satisfies_mfa()'::regprocedure),
  'session_satisfies_mfa pins an empty search_path'
);
select ok(
  not has_function_privilege('anon', 'public.session_satisfies_mfa()', 'execute')
  and has_function_privilege('authenticated', 'public.session_satisfies_mfa()', 'execute'),
  'only authenticated (the policies'' role) may execute the helper'
);

select * from finish();
rollback;
