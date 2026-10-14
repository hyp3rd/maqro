-- The shapes the server-side profiles writers rely on (Stripe checkout and
-- webhook, admin role/trace): a payload-less upsert can never write a row,
-- and a checked UPDATE ... RETURNING tells "changed exactly one row" apart
-- from "matched nothing". Server writers run as service_role, which bypasses
-- RLS and which the 0068/0073 guard trusts.
--
-- Accounts start without a profiles row (any row a sign-up hook created is
-- removed first), so these hold both before and after a row exists from
-- sign-up. Run with `supabase test db`; see CONTRIBUTING.md §10.
begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, email, aud, role) values
  ('c0000000-0000-4000-8000-000000000001', 'synced@example.test', 'authenticated', 'authenticated'),
  ('c0000000-0000-4000-8000-000000000002', 'unsynced@example.test', 'authenticated', 'authenticated');

delete from public.profiles
 where user_id in (
   'c0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000002'
 );

-- The synced account's profile, as its first push left it.
insert into public.profiles (user_id, payload)
values ('c0000000-0000-4000-8000-000000000001', '{"age": 30}');

set local role service_role;

-- Checkout's old write. NOT NULL is checked on the proposed row before
-- ON CONFLICT is resolved, so it fails even though the row exists.
select throws_ok(
  $$
    insert into public.profiles (user_id, stripe_customer_id)
    values ('c0000000-0000-4000-8000-000000000001', 'cus_test_partial')
    on conflict (user_id) do update set stripe_customer_id = excluded.stripe_customer_id
  $$,
  '23502',
  null,
  'a payload-less upsert fails even when the row exists'
);

-- Checkout's checked link: only while the row has no customer yet.
select results_eq(
  $$
    update public.profiles set stripe_customer_id = 'cus_test_first'
     where user_id = 'c0000000-0000-4000-8000-000000000001'
       and stripe_customer_id is null
    returning user_id
  $$,
  $$ values ('c0000000-0000-4000-8000-000000000001'::uuid) $$,
  'checkout''s customer link matches exactly one row'
);

select is_empty(
  $$
    update public.profiles set stripe_customer_id = 'cus_test_second'
     where user_id = 'c0000000-0000-4000-8000-000000000001'
       and stripe_customer_id is null
    returning user_id
  $$,
  'a second, concurrent customer link matches nothing and keeps the first'
);

select is_empty(
  $$
    update public.profiles set stripe_customer_id = 'cus_test_orphan'
     where user_id = 'c0000000-0000-4000-8000-000000000002'
       and stripe_customer_id is null
    returning user_id
  $$,
  'the customer link matches nothing for an account with no profiles row'
);

select results_eq(
  $$
    update public.profiles
       set stripe_subscription_id = 'sub_test', subscription_status = 'trialing', is_premium = true
     where user_id = 'c0000000-0000-4000-8000-000000000001'
    returning user_id
  $$,
  $$ values ('c0000000-0000-4000-8000-000000000001'::uuid) $$,
  'the checkout webhook''s entitlement UPDATE matches exactly one row'
);

select is_empty(
  $$
    update public.profiles set role = 'admin'
     where user_id = 'c0000000-0000-4000-8000-000000000002'
    returning user_id
  $$,
  'the admin role change matches nothing for an account with no profiles row'
);

select results_eq(
  $$
    select payload, stripe_customer_id, is_premium from public.profiles
     where user_id = 'c0000000-0000-4000-8000-000000000001'
  $$,
  $$ values ('{"age": 30}'::jsonb, 'cus_test_first'::text, true) $$,
  'server writes keep the synced payload intact'
);

reset role;

select * from finish();
rollback;
