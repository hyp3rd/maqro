-- Fix the profiles guard (0068) so new users can create their profile row.
--
-- 0068's INSERT branch resets every server-managed column to its safe
-- default, but one entry in that list — `new.welcome_sent_at` — is not a
-- profiles column: it lives on `public.notification_preferences` (0014).
-- PL/pgSQL resolves record fields only when a statement executes, so
-- `create function` accepted the body and the defect surfaced at run time,
-- on the first end-user INSERT:
--
--     ERROR 42703: record "new" has no field "welcome_sent_at"
--
-- Every end-user INSERT reaches that branch, including the
-- `INSERT ... ON CONFLICT DO UPDATE` that supabase-js `.upsert()` sends
-- (BEFORE INSERT row triggers fire before conflict detection). The browser
-- sync engine upserts the profile on a user's first push (lib/sync/index.ts
-- `pushRow`), so no account created after 0068 shipped could create its
-- profile row — and because `runInitialSync` pushes tables sequentially and
-- stops at the first error, none of those users' other data reached the
-- server either. Their edits are still queued as dirty rows in IndexedDB;
-- the first sync after this migration pushes them.
--
-- Fix: the same function minus that one assignment. Every other column in
-- the reset list exists on public.profiles (checked against the live
-- schema). The UPDATE branch is unchanged, and the trigger created in 0068
-- keeps firing this function — `create or replace` preserves its OID.
--
-- Regression coverage (`supabase test db`):
--   - supabase/tests/profiles_guard_server_columns_test.sql runs the guard as
--     an end user: a first-time upsert must succeed, and every server-managed
--     column must be reset on INSERT — derived from the catalog, so a column
--     added to profiles without a matching reset below fails the test.
--   - supabase/tests/plpgsql_functions_check_test.sql type-checks every
--     public PL/pgSQL trigger function against each table it is attached to.
--     `supabase db lint` cannot catch this class: it checks trigger functions
--     without a relation, so NEW/OLD fields are never resolved.

create or replace function public.profiles_guard_server_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Trust every role except the two PostgREST end-user roles. Service-role,
  -- postgres, and dashboard/admin connections fall through here untouched.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Allowlist by exclusion: an end user may only move `payload` (and the
    -- DB-managed `updated_at`). Comparing the rest of the row as jsonb keeps
    -- this guard correct when columns are added later — any new column is
    -- protected automatically, with no edit to this function.
    if (to_jsonb(new) - 'payload' - 'updated_at')
       is distinct from
       (to_jsonb(old) - 'payload' - 'updated_at') then
      raise exception
        'profiles: end users may only modify the payload column'
        using errcode = '42501'; -- insufficient_privilege
    end if;
    return new;
  end if;

  -- INSERT (the first sync upserts the row into existence): accept the
  -- client's user_id + payload, but force every server-managed column to its
  -- safe default so a crafted INSERT can't seed role='admin' / is_premium.
  --
  -- ⚠️  When you add a new SERVER-MANAGED column to public.profiles, reset it
  --     to its default here too (UPDATEs are already covered above) —
  --     supabase/tests/profiles_guard_server_columns_test.sql fails until you
  --     do. Only name columns that exist on public.profiles.
  new.role                               := 'user';
  new.is_premium                         := false;
  new.is_grandfathered                   := false;
  new.traced                             := false;
  new.stripe_customer_id                 := null;
  new.stripe_subscription_id             := null;
  new.stripe_price_id                    := null;
  new.subscription_status                := null;
  new.current_period_end                 := null;
  new.grandfather_until                  := null;
  new.trial_ending_email_sent_at         := null;
  new.subscription_confirmed_email_sent_at := null;
  new.cancellation_email_sent_at         := null;
  new.payment_failed_email_sent_at       := null;
  new.backup_email                       := null;
  new.backup_email_verified_at           := null;
  new.backup_email_pending               := null;
  new.backup_email_code_hash             := null;
  new.backup_email_code_expires_at       := null;
  return new;
end;
$$;
