-- Enforce the second factor in the database, not only in Next.js.
--
-- Until now TOTP was checked by the proxy (page navigations to /app, /admin)
-- and by assertAal2 in API route handlers. Every RLS policy only asked
-- `user_id = auth.uid()`, and nothing looked at the JWT's assurance level.
-- The browser talks to PostgREST, Storage and Realtime directly with the
-- user's JWT and the public publishable key, so a session that had passed
-- only the FIRST factor (email OTP, magic link, OAuth, the backup-email
-- recovery link) could read and write all of an MFA-enrolled user's health
-- data, their storage objects, and — for an admin — the cross-user
-- trace_events / admin_audit_log / admin_sessions tables, without ever
-- being asked for the code. That is exactly the attacker TOTP exists to
-- stop (see 0067's header: "anyone with email access alone").
--
-- Fix, following Supabase's "Enforce MFA" guide
-- (https://supabase.com/docs/guides/auth/auth-mfa, "Enforce only for users
-- that have opted-in"): a RESTRICTIVE policy, to `authenticated`, on every
-- table end users can reach and on storage.objects. Restrictive policies are
-- AND-ed with the existing permissive owner/admin policies, so they only
-- ever remove access. The predicate lives in one helper:
--
--   public.session_satisfies_mfa() is true when
--     - the JWT is aal2, or
--     - the session was established with a passkey (`amr` method
--       'passkey' — GoTrue's PasskeyLogin; Supabase issues passkey sign-ins
--       as aal1, and the app has always treated a passkey as meeting the
--       second-factor bar, see lib/auth/mfa-policy.ts), or
--     - the user has NO verified MFA factor (nothing more to prove).
--
-- The `aal` / `amr` claims come from the JWT that PostgREST / Storage /
-- Realtime already verified. It is SECURITY DEFINER because
-- auth.mfa_factors is not readable by `authenticated`; it reads only the
-- caller's own rows (`auth.uid()`) and returns a boolean. Policies call it
-- as `(select public.session_satisfies_mfa())` so Postgres evaluates it
-- once per statement (initplan), not once per row. lib/auth/mfa-policy.ts
-- implements the same rule for the server gates and the sync client; the
-- two must stay in step.
--
-- Tables covered: every public table with a permissive policy that applies
-- to `authenticated` (the owner-scoped data tables, the admin-readable
-- tables, comp_grants, ai_usage_monthly, push_* ...). Deliberately not:
--   - status_probes: public status data, also readable by `anon`, so gating
--     `authenticated` would protect nothing.
--   - mfa_trusted_devices: end-user access is revoked outright in 0078.
-- supabase/tests/mfa_rls_enforcement_test.sql derives the expected set from
-- the catalog, so a new table that end users can reach fails the test until
-- it is added here (or to a later migration).
--
-- Deployment — HOLD until the previous release has rolled out.
-- supabase-migrations.yml runs `supabase db push` on merge, before every
-- open tab and service-worker-cached PWA has picked up the new bundle.
-- Sessions that satisfy the rule today — every aal2 session, passkey
-- sessions, and every user without MFA — are unaffected. The sessions it
-- newly rejects are aal1 sessions of enrolled users: attackers holding only
-- the first factor, and legitimate browsers that skipped TOTP through the
-- "trust this device" grant. A client built before the release that retired
-- that grant (0078) and taught sync to wait for aal2 still pushes from such
-- a session, reads the 42501 as a primary-key collision, re-mints the row's
-- id and retries without bound — an endless request loop that also orphans
-- local references to the old id. So this migration ships in its own change,
-- merged only after the 0078 release (and its service-worker update) is
-- live and old bundles have aged out; the same hold the repo applied to
-- 0074. Numbered after 0078 so `supabase db push` applies it in order.

create or replace function public.session_satisfies_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
    or exists (
      select 1
        from jsonb_array_elements(
               case
                 when jsonb_typeof(auth.jwt() -> 'amr') = 'array'
                   then auth.jwt() -> 'amr'
                 else '[]'::jsonb
               end
             ) as m (entry)
       -- `amr` entries are `{ "method": ..., "timestamp": ... }` objects
       -- (RFC 8176 also allows bare strings; accept both).
       where lower(
               case jsonb_typeof(m.entry)
                 when 'string' then m.entry #>> '{}'
                 when 'object' then m.entry ->> 'method'
               end
             ) = 'passkey'
    )
    or not exists (
      select 1
        from auth.mfa_factors f
       where f.user_id = auth.uid()
         and f.status = 'verified'
    );
$$;

comment on function public.session_satisfies_mfa() is
  'True when the caller''s JWT meets the second-factor rule: aal2, a passkey sign-in, or no verified MFA factor. Used by the mfa_second_factor_required restrictive RLS policies (0079); mirrored by lib/auth/mfa-policy.ts.';

-- Callable only by the role the policies apply to. anon has no data access
-- through these tables (the policies are `to authenticated`), and exposing
-- it via /rest/v1/rpc to authenticated only reveals the caller's own
-- assurance state.
revoke all on function public.session_satisfies_mfa() from public, anon;
grant execute on function public.session_satisfies_mfa() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'admin_audit_log',
    'admin_sessions',
    'ai_usage_monthly',
    'blood_pressure',
    'body_measurements',
    'captures',
    'comp_grants',
    'custom_foods',
    'daily_logs',
    'fast_sessions',
    'favorite_foods',
    'favorite_stores',
    'meal_schedules',
    'meal_templates',
    'micronutrient_profiles',
    'micronutrient_queue',
    'notification_preferences',
    'pantry_items',
    'pantry_notifications',
    'profiles',
    'push_event_log',
    'push_subscriptions',
    'recipes',
    'supplement_intake',
    'supplements',
    'trace_events',
    'user_devices',
    'water_intake',
    'weight_history'
  ]
  loop
    execute format(
      'drop policy if exists "mfa_second_factor_required" on public.%I',
      t
    );
    execute format(
      'create policy "mfa_second_factor_required" on public.%I '
      'as restrictive for all to authenticated '
      'using ((select public.session_satisfies_mfa())) '
      'with check ((select public.session_satisfies_mfa()))',
      t
    );
  end loop;
end
$$;

-- Storage: the private `captures` and `exports` buckets (0004/0005), and any
-- bucket added later. Applies to every storage.objects command an end user
-- can issue through the Storage API.
drop policy if exists "mfa_second_factor_required" on storage.objects;
create policy "mfa_second_factor_required"
  on storage.objects
  as restrictive
  for all
  to authenticated
  using ((select public.session_satisfies_mfa()))
  with check ((select public.session_satisfies_mfa()));
