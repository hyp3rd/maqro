-- training_day_overrides (migration 0081): per-date training-session
-- overrides, one row per (user, day).
--
-- Checks the schema contract the client sync relies on (composite key,
-- cascade, updated_at trigger, realtime), owner isolation for every command,
-- the shape CHECKs, and the restrictive second-factor policy. End-user
-- requests are simulated the way PostgREST runs them: `set local role
-- authenticated` plus `request.jwt.claims`, which auth.uid() and auth.jwt()
-- read. Run with `supabase test db`; see CONTRIBUTING.md §10.
begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

-- ── Fixtures (as postgres: bypasses RLS) ────────────────────────────────────
-- alice: no MFA factor. bob: no MFA factor. carol: a verified TOTP factor.
insert into auth.users (id, email, aud, role) values
  ('b0000000-0000-4000-8000-000000000001', 'alice@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-000000000002', 'bob@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-000000000003', 'carol@example.test', 'authenticated', 'authenticated');

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003', 'phone app', 'totp', 'verified', now(), now());

insert into public.training_day_overrides (user_id, date, day) values
  ('b0000000-0000-4000-8000-000000000002', '2026-10-21', '{"type": "lower", "intensity": "hard"}'),
  ('b0000000-0000-4000-8000-000000000003', '2026-10-21', '{"type": "rest"}');

-- ── Schema ──────────────────────────────────────────────────────────────────
select col_is_pk(
  'public', 'training_day_overrides', array['user_id', 'date'],
  'keyed per user and day: primary key (user_id, date)'
);
select fk_ok(
  'public', 'training_day_overrides', 'user_id',
  'auth', 'users', 'id',
  'user_id references auth.users (id)'
);
select results_eq(
  $$ select confdeltype::text from pg_constraint
      where conrelid = 'public.training_day_overrides'::regclass and contype = 'f' $$,
  $$ values ('c') $$,
  'the user foreign key cascades on delete (account deletion)'
);
select has_trigger(
  'public', 'training_day_overrides', 'training_day_overrides_set_updated_at',
  'updated_at is maintained by the set_updated_at trigger'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.training_day_overrides'::regclass),
  'row level security is on'
);
select policies_are(
  'public', 'training_day_overrides',
  array['training_day_overrides_owner_all', 'mfa_second_factor_required'],
  'exactly the owner policy and the second-factor policy'
);
select ok(
  exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'training_day_overrides'
       and policyname = 'mfa_second_factor_required'
       and permissive = 'RESTRICTIVE'
       and cmd = 'ALL'
       and roles = array['authenticated']::name[]
       and qual like '%session_satisfies_mfa()%'
       and with_check like '%session_satisfies_mfa()%'
  ),
  'the second-factor policy is restrictive, for all commands, to authenticated'
);
select ok(
  exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'training_day_overrides'
  ),
  'published to supabase_realtime'
);

-- updated_at is the sync engine's optimistic-concurrency token, so every
-- UPDATE must move it. now() is this transaction's start time, so the row
-- starts from an explicit past stamp (an INSERT doesn't fire the trigger);
-- it is removed again so the counts below are unaffected.
insert into public.training_day_overrides (user_id, date, day, updated_at) values
  ('b0000000-0000-4000-8000-000000000002', '2026-10-30', '{"type": "rest"}', '2000-01-01T00:00:00Z');
update public.training_day_overrides set day = '{"type": "upper"}'
 where user_id = 'b0000000-0000-4000-8000-000000000002' and date = '2026-10-30';
select ok(
  (select updated_at > '2000-01-01T00:00:00Z'::timestamptz from public.training_day_overrides
    where user_id = 'b0000000-0000-4000-8000-000000000002' and date = '2026-10-30'),
  'an UPDATE bumps updated_at'
);
select is(
  (select updated_at from public.training_day_overrides
    where user_id = 'b0000000-0000-4000-8000-000000000002' and date = '2026-10-30'),
  now(),
  'the bumped updated_at is the update''s now() (set_updated_at)'
);
delete from public.training_day_overrides
 where user_id = 'b0000000-0000-4000-8000-000000000002' and date = '2026-10-30';

-- ── alice (no factor, aal1): her own rows only ──────────────────────────────
select set_config('request.jwt.claims', '{"sub": "b0000000-0000-4000-8000-000000000001", "role": "authenticated", "aal": "aal1"}', true);
set local role authenticated;

select lives_ok(
  $$ insert into public.training_day_overrides (user_id, date, day)
     values ('b0000000-0000-4000-8000-000000000001', '2026-10-21', '{"type": "rest"}') $$,
  'alice can override her own day'
);
select lives_ok(
  $$ insert into public.training_day_overrides (user_id, date, day)
     values ('b0000000-0000-4000-8000-000000000001', '2026-10-21', '{"type": "upper"}')
     on conflict (user_id, date) do update set day = excluded.day $$,
  'the same date for alice is the same row (upsert path)'
);
select results_eq(
  $$ select user_id::text, date, day ->> 'type' from public.training_day_overrides $$,
  $$ values ('b0000000-0000-4000-8000-000000000001'::text, '2026-10-21'::text, 'upper'::text) $$,
  'alice sees only her own row, never bob''s for the same date'
);
select throws_ok(
  $$ insert into public.training_day_overrides (user_id, date, day)
     values ('b0000000-0000-4000-8000-000000000002', '2026-10-22', '{"type": "rest"}') $$,
  '42501', null,
  'alice cannot write a row for bob'
);
select is_empty(
  $$ update public.training_day_overrides set day = '{"type": "rest"}'
      where user_id = 'b0000000-0000-4000-8000-000000000002' returning 1 $$,
  'alice''s update of bob''s row matches nothing'
);
select is_empty(
  $$ delete from public.training_day_overrides
      where user_id = 'b0000000-0000-4000-8000-000000000002' returning 1 $$,
  'alice''s delete of bob''s row matches nothing'
);
select throws_ok(
  $$ update public.training_day_overrides
        set user_id = 'b0000000-0000-4000-8000-000000000002'
      where user_id = 'b0000000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'alice cannot hand her row to bob'
);
select throws_ok(
  $$ insert into public.training_day_overrides (user_id, date, day)
     values ('b0000000-0000-4000-8000-000000000001', '21/10/2026', '{"type": "rest"}') $$,
  '23514', null,
  'a date that is not YYYY-MM-DD is rejected'
);
select throws_ok(
  $$ insert into public.training_day_overrides (user_id, date, day)
     values ('b0000000-0000-4000-8000-000000000001', '2026-10-23', '"rest"') $$,
  '23514', null,
  'a day that is not a JSON object is rejected'
);
select lives_ok(
  $$ delete from public.training_day_overrides
      where user_id = 'b0000000-0000-4000-8000-000000000001' and date = '2026-10-21' $$,
  'alice can delete her own override (back to plan)'
);
select is_empty(
  $$ select 1 from public.training_day_overrides $$,
  'after the delete alice has no rows'
);
reset role;

select results_eq(
  $$ select count(*)::int from public.training_day_overrides
      where user_id = 'b0000000-0000-4000-8000-000000000002' $$,
  $$ values (1) $$,
  'bob''s row survived every one of alice''s attempts'
);

-- ── carol (verified factor): aal1 is denied, aal2 sees her row ──────────────
select set_config('request.jwt.claims', '{"sub": "b0000000-0000-4000-8000-000000000003", "role": "authenticated", "aal": "aal1", "amr": [{"method": "password", "timestamp": 1}]}', true);
set local role authenticated;
select is_empty(
  $$ select 1 from public.training_day_overrides $$,
  'aal1 with a verified factor: own overrides are not readable'
);
select throws_ok(
  $$ insert into public.training_day_overrides (user_id, date, day)
     values ('b0000000-0000-4000-8000-000000000003', '2026-10-22', '{"type": "rest"}') $$,
  '42501', null,
  'aal1 with a verified factor: inserts are rejected'
);
reset role;

select set_config('request.jwt.claims', '{"sub": "b0000000-0000-4000-8000-000000000003", "role": "authenticated", "aal": "aal2", "amr": [{"method": "totp", "timestamp": 1}]}', true);
set local role authenticated;
select results_eq(
  $$ select date from public.training_day_overrides $$,
  $$ values ('2026-10-21'::text) $$,
  'aal2: carol sees her own override'
);
reset role;

-- ── Account deletion cascades ───────────────────────────────────────────────
delete from auth.users where id = 'b0000000-0000-4000-8000-000000000002';
select is_empty(
  $$ select 1 from public.training_day_overrides
      where user_id = 'b0000000-0000-4000-8000-000000000002' $$,
  'deleting the account removes its overrides'
);

select * from finish();
rollback;
