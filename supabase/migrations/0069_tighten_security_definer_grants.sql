-- Tighten three SECURITY DEFINER helpers to service-role-only execution.
--
-- The Supabase security advisor flagged `check_throttle`,
-- `bump_onboarding_counter`, and `email_taken_by_other_user` as SECURITY
-- DEFINER functions executable by the `anon` / `authenticated` roles via
-- `/rest/v1/rpc`. All three are SECURITY DEFINER for a legitimate reason — they
-- write to no-policy tables (auth_throttle, onboarding_step_counters) or read
-- `auth.users`, none of which an RLS-bound role can touch directly. But NONE of
-- them is meant to be called by an end-user client: every caller goes through
-- the SERVICE-ROLE admin client, server-side.
--
--   - check_throttle            ← lib/rate-limit.ts  (admin.rpc)
--   - bump_onboarding_counter   ← app/api/onboarding/events/route.ts (admin.rpc;
--       the anon browser POSTs to that API route, which then calls the RPC with
--       the service-role key — the browser never calls the RPC itself)
--   - email_taken_by_other_user ← app/api/account/backup-email/start/route.ts
--       (admin.rpc, passing the authenticated user's id as excluding_user)
--
-- The leftover anon/authenticated/PUBLIC grants are unnecessary attack surface:
--
--   - check_throttle: callable by PUBLIC (migration 0036 never revoked the
--     default execute). An attacker could call it directly with a victim's
--     bucket key (e.g. 'auth-recovery:target:victim@example.com') and increment
--     it to the limit, locking the victim out of recovery / backup-email WITHOUT
--     sending a single real request — a denial-of-service against the rate
--     limiter itself.
--   - email_taken_by_other_user: returns whether `candidate` is a primary email
--     for any user OTHER than `excluding_user` — and `excluding_user` is a
--     PARAMETER, not auth.uid(). A caller passing a throwaway uuid gets a yes/no
--     "is this a registered Maqro email" — an email-ENUMERATION oracle, and with
--     `anon` execute (the deployed state) an UNAUTHENTICATED one. (The 0030
--     comment's "the function self-enforces exclude-my-own-id" claim is wrong for
--     exactly this reason; only the trusted server passes the right id.)
--   - bump_onboarding_counter: lower stakes (aggregate, input-validated, no PII)
--     but still lets anyone inflate the funnel counters.
--
-- Fix: revoke EXECUTE from PUBLIC / anon / authenticated on all three. They stay
-- SECURITY DEFINER and keep working for the service-role callers (`service_role`
-- and the `postgres` owner retain execute). Revoking a privilege a role doesn't
-- hold is a no-op, so listing all three targets is safe everywhere. This also
-- clears the advisor findings, because anon/authenticated can no longer execute
-- the functions.

revoke execute on function public.check_throttle(text, int, int)
  from public, anon, authenticated;

revoke execute on function public.bump_onboarding_counter(smallint, text)
  from public, anon, authenticated;

revoke execute on function public.email_taken_by_other_user(text, uuid)
  from public, anon, authenticated;

-- ── Verification (run after applying) ───────────────────────────────────────
-- Only `postgres` + `service_role` should remain:
--   select routine_name, grantee, privilege_type
--     from information_schema.routine_privileges
--    where routine_schema = 'public'
--      and routine_name in (
--        'check_throttle', 'bump_onboarding_counter', 'email_taken_by_other_user'
--      )
--    order by routine_name, grantee;
-- Then re-run the security advisor: the three function findings should be gone,
-- and the rate-limit / onboarding / backup-email flows (all service-role) keep
-- working unchanged.
