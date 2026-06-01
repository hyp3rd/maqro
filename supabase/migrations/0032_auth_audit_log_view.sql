-- Expose `auth.audit_log_entries` to the admin UI via a narrowly-
-- scoped view in the `public` schema.
--
-- Why a view instead of adding `auth` to PostgREST's exposed
-- schemas (Project Settings → API → Exposed schemas): exposing the
-- entire `auth` schema would also expose `auth.users`,
-- `auth.mfa_factors`, `auth.refresh_tokens`, and
-- `auth.one_time_tokens` to the data API. RLS gates them, but
-- making sensitive tables queryable at all widens the attack
-- surface — a misconfigured policy or a service-role key leak
-- becomes a much bigger incident. A view in `public` exposes only
-- the four columns we actually render in the admin "Auth events"
-- tab and nothing else.
--
-- `security_invoker = false` runs the view's underlying query as
-- the view's OWNER (postgres) rather than the caller (service_role),
-- which is what lets the view reach into `auth.audit_log_entries`
-- without granting service_role any direct privileges on the
-- `auth` schema. This is the PG-15+ explicit form of the pre-PG-15
-- default behaviour; setting it explicitly avoids drift if
-- Supabase ever flips the project default.
--
-- Only `service_role` gets SELECT — `anon` and `authenticated`
-- are revoked explicitly. The admin audit page hits this via the
-- service-role admin client (same pattern as `admin_audit_log`).

create or replace view public.auth_audit_events
with (security_invoker = false) as
select
  id,
  created_at,
  ip_address,
  payload
from auth.audit_log_entries;

-- Tighten the default grants. PostgreSQL grants SELECT to PUBLIC
-- on newly-created views by default; revoke that and reissue only
-- to service_role so anon / authenticated can't shortcut into
-- this data via PostgREST.
revoke all on public.auth_audit_events from public;
revoke all on public.auth_audit_events from anon;
revoke all on public.auth_audit_events from authenticated;
grant select on public.auth_audit_events to service_role;

comment on view public.auth_audit_events is
  'Read-only window into auth.audit_log_entries for the admin audit page. Service-role only; runs as the view owner (security_invoker=false) so we don''t need to expose the auth schema to PostgREST.';
