-- Guarantee every account a public.profiles row, created server-side at sign-up.
--
-- Until now the only thing that created a profiles row was the browser sync
-- engine's first profile push (lib/sync/index.ts `pushProfile`), which needs a
-- real, edited local profile and a successful sync. Every server-side writer
-- assumed the row existed, and each one failed in a different way without it:
--
--   - Stripe checkout tried to store the new customer id with a service-role
--     `upsert({ user_id, stripe_customer_id })`. payload is NOT NULL with no
--     default, and Postgres checks NOT NULL on the proposed row BEFORE it
--     resolves ON CONFLICT, so that statement failed with 23502 for EVERY user,
--     whether or not a row already existed. The error was ignored.
--   - The checkout.session.completed webhook ran `update ... where user_id = $1`,
--     which updates 0 rows when there is no row. That is not an error, so the
--     event was recorded as a success and the user was charged without being
--     entitled. The customer.subscription.* events then failed with "No profile
--     found for Stripe customer".
--   - The admin role route's partial upsert failed with the same 23502, and the
--     admin trace toggle reported success after updating 0 rows.
--
-- Accounts created after 0068 shipped (and before 0073 fixed its INSERT branch)
-- could not create the row at all, and any user can reach checkout before
-- their first profile push lands.
--
-- Fix (owner decision): an AFTER INSERT trigger on auth.users inserts
-- (user_id, payload '{}') for each new account, plus an idempotent backfill for
-- existing accounts that have no row. The empty payload means "no profile yet":
-- the client sync pull and realtime handler ignore it (lib/sync/mappers.ts
-- `profileFromRow`), and the client's first profile push upserts its real
-- payload onto the row — the 0068/0073 guard lets an end-user upsert onto an
-- existing row move only `payload`. Server writers can now use checked UPDATEs
-- that match exactly one row.
--
-- The trigger function runs as its owner (SECURITY DEFINER), so the guard's
-- "trust every role except authenticated/anon" branch lets the insert through
-- and RLS does not apply. It inserts only user_id and payload; every other
-- column takes its table default (role 'user', is_premium false, no Stripe
-- state). ON CONFLICT DO NOTHING keeps it from ever failing a sign-up because a
-- row already exists. Nothing but the trigger should call it, so EXECUTE is
-- revoked from public/anon/authenticated (a trigger fires regardless of the
-- invoking role's EXECUTE privilege).
--
-- ⚠️  ROLLOUT ORDER. Clients built before the `{}`-aware sync change apply ANY
--     server profile row over a local profile that has never synced (and apply
--     every realtime UPDATE). On such a client a `{}` row replaces the local
--     profile with defaults: a guest's pre-sign-up profile, or the not-yet-pushed
--     profile of an account created while 0068 blocked profile inserts. Ship
--     the client change first and let it roll out before this migration
--     reaches production.
--
-- Regression coverage (`supabase test db`):
--   - supabase/tests/profiles_row_on_signup_test.sql — sign-up creates the
--     row, its server state is the default, the function is locked down, the
--     client's first push and the server's checked UPDATEs land on the row.
--   - supabase/tests/plpgsql_functions_check_test.sql type-checks the trigger
--     function against auth.users.

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, payload)
  values (new.id, '{}'::jsonb)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.create_profile_for_new_user()
  from public, anon, authenticated;

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

-- Backfill: every existing account without a row gets the same placeholder.
-- Idempotent — re-running inserts nothing.
insert into public.profiles (user_id, payload)
select u.id, '{}'::jsonb
  from auth.users u
 where not exists (select 1 from public.profiles p where p.user_id = u.id)
on conflict (user_id) do nothing;

-- ── Verification (run after applying) ───────────────────────────────────────
-- Every account has a row:
--   select count(*) from auth.users u
--    where not exists (select 1 from public.profiles p where p.user_id = u.id);
--   -- expect 0
-- Only postgres + service_role can execute the function:
--   select grantee, privilege_type from information_schema.routine_privileges
--    where routine_schema = 'public'
--      and routine_name = 'create_profile_for_new_user';
