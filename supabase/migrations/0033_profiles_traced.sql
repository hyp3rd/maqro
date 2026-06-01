-- Per-user "trace" flag for admin observability. When set, the
-- error reporter captures expanded context (untruncated stack,
-- request headers, user agent) for events tied to this user —
-- the operator equivalent of "tail this user's logs" without
-- having to enable verbose logging globally.
--
-- Default false; only admins can toggle (via
-- /api/admin/users/[id]/action with action="trace"|"untrace").
-- RLS already prevents self-set: writes go through the admin
-- route's service-role client, and the user-facing profile
-- patcher in app/api/account doesn't include `traced` in its
-- allowed column list.
--
-- Intentional limits:
--   - Boolean only — no expiry timestamp. If a trace becomes
--     stale, the operator clears it manually. Adding TTL state
--     complicates the read path for marginal benefit.
--   - No retention bump — traced rows in `error_log` follow the
--     same 90-day window as everything else. If a longer
--     window is needed for a specific investigation, exporting
--     the rows out of `error_log` is the right tool, not a
--     schema-side flag.

alter table public.profiles
  add column if not exists traced boolean not null default false;

-- Partial index so the admin "Filter: Traced" path can hit a
-- small slice cheaply. Most users are NOT traced; full-table
-- scans for the rare-true case waste IO.
create index if not exists profiles_traced_idx
  on public.profiles (user_id)
  where traced = true;

comment on column public.profiles.traced is
  'Admin-set debugging flag. When true, error reporter captures expanded context for events tied to this user. Toggled via /api/admin/users/[id]/action; user-facing profile updates cannot set it.';
