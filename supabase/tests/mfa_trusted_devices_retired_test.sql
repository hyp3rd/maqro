-- The retired trusted-device grant table (migration 0078) is unreachable
-- from the Data API: an end-user session can neither read the stale device
-- ids (the old bypass key) nor plant a new grant. Run with
-- `supabase test db`; see CONTRIBUTING.md §10.
begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, email, aud, role) values
  ('e0000000-0000-4000-8000-000000000001', 'trusted@example.test', 'authenticated', 'authenticated');

insert into public.mfa_trusted_devices (user_id, device_id, trusted_until)
values ('e0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', now() + interval '7 days');

select is_empty(
  $$ select policyname from pg_policies
      where schemaname = 'public' and tablename = 'mfa_trusted_devices' $$,
  'mfa_trusted_devices has no end-user policies left'
);

select ok(
  not exists (
    select 1
      from (values ('anon'), ('authenticated')) r (role_name),
           unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p (priv)
     where has_table_privilege(r.role_name, 'public.mfa_trusted_devices', p.priv)
  ),
  'anon and authenticated hold no privilege on mfa_trusted_devices'
);

-- Even an aal2 session of the row's owner is refused outright.
select set_config('request.jwt.claims', '{"sub": "e0000000-0000-4000-8000-000000000001", "role": "authenticated", "aal": "aal2"}', true);
set local role authenticated;

select throws_ok(
  $$ select device_id from public.mfa_trusted_devices $$,
  '42501', null,
  'the owner cannot read their old device ids'
);
select throws_ok(
  $$ insert into public.mfa_trusted_devices (user_id, device_id, trusted_until)
     values ('e0000000-0000-4000-8000-000000000001', 'attacker-device', now() + interval '7 days') $$,
  '42501', null,
  'nobody can plant a trust grant'
);
select throws_ok(
  $$ delete from public.mfa_trusted_devices $$,
  '42501', null,
  'end users cannot touch the table at all'
);

reset role;
select * from finish();
rollback;
