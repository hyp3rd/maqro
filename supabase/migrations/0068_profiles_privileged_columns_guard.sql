-- Stop end users from self-granting privileges on their own profile row.
--
-- The hole this closes: `public.profiles` has a single RLS policy,
-- `profiles_owner_all` (FOR ALL, `user_id = auth.uid()`), and no
-- column-level grants. That policy is row-scoped but NOT column-scoped,
-- so an authenticated user can craft a direct PostgREST request against
-- their OWN row and set columns that are supposed to be server-managed:
--
--     PATCH /rest/v1/profiles?user_id=eq.<self>   { "role": "admin" }
--     PATCH /rest/v1/profiles?user_id=eq.<self>   { "is_premium": true }
--
-- => instant admin escalation / free Pro, plus tampering with the Stripe
-- billing mirror and the backup-email recovery fields.
--
-- The legitimate client never writes any of those: the browser sync
-- engine pushes exactly one column on this table — `payload` (the user's
-- nutrition profile; see lib/sync/mappers.ts `profileToRow`). Everything
-- else (role, is_premium, the stripe_*/subscription_*/grandfather billing
-- state, the *_email_sent_at stamps, the backup_email_* recovery fields,
-- `traced`) is written only by the service-role key (Stripe webhook,
-- admin grants, the backup-email + recovery routes).
--
-- Fix: a BEFORE INSERT OR UPDATE trigger that policies ONLY end-user
-- writes (PostgREST runs them as the `authenticated` / `anon` Postgres
-- role) and leaves every trusted role — service_role, postgres, admin
-- tooling — untouched. Detecting the role by `current_user` (the actual
-- SET ROLE'd Postgres role), not a JWT claim, so a mis-shaped JWT can
-- never accidentally police a real service-role write and break billing.
--
-- We keep the `profiles_owner_all` policy as-is (the user still needs to
-- UPDATE their row to sync `payload`); the trigger adds the column-level
-- guard the policy can't express.
--
-- `set search_path = ''` per the repo convention (see 0030): forces
-- fully-qualified names so a search_path hijack can't mask a function.

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
  --     to its default here too. (UPDATEs are already covered above.)
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
  new.welcome_sent_at                    := null;
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

drop trigger if exists profiles_guard_server_columns on public.profiles;
create trigger profiles_guard_server_columns
  before insert or update on public.profiles
  for each row
  execute function public.profiles_guard_server_columns();

-- ── Manual verification (run on a branch / staging before production) ───────
-- As an AUTHENTICATED user (PostgREST or the dashboard "as a user"):
--   update profiles set role = 'admin'  where user_id = auth.uid();  -- ⇒ 42501
--   update profiles set is_premium = true where user_id = auth.uid(); -- ⇒ 42501
--   update profiles set payload = payload where user_id = auth.uid();  -- ⇒ ok
-- A crafted insert with role='admin' must land role='user'.
-- As the SERVICE ROLE: update profiles set is_premium = true ... ⇒ ok (bypass).
