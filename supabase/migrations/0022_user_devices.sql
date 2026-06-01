-- Device management — list and disconnect the user's signed-in
-- sessions from Settings → Signed-in devices.
--
-- Identity model. A "device" here is really a Supabase auth SESSION
-- (one row per sign-in). We track it by the session_id JWT claim,
-- NOT the raw refresh token: refresh tokens rotate on every refresh,
-- so they're useless as a stable per-session key. session_id is
-- stable across rotations for the life of the session (created on
-- sign-in, invalidated on sign-out or admin revoke), which is
-- exactly the granularity the user expects when they see "Chrome on
-- macOS · 3 days ago" in the list.
--
-- Why store the raw session_id (not a hash): the disconnect path
-- needs to revoke the underlying Supabase session, and Supabase
-- exposes no admin API that accepts a hashed session identifier —
-- revocation works by deleting the matching `auth.sessions` row,
-- which means we need the raw `id`. RLS scopes reads/writes to
-- `auth.uid() = user_id`, so a leaked row would only reveal a
-- session_id that's already in that user's own JWT.
--
-- Grace constraint. The "sign out other devices" path requires the
-- calling device's first_seen_at to be older than 12 hours. Enforced
-- application-side (in `/api/devices/disconnect`) rather than via a
-- trigger because the policy needs a clear error message back to the
-- caller and SQL exceptions read as ugly 500s in the dialog.
--
-- Cleanup. Rows are deleted explicitly when:
--   - the user disconnects a device from Settings (admin API +
--     row delete in the same handler), or
--   - the user signs out from a device (client deletes its own row
--     pre-signOut, defensive against stale entries piling up).
-- Abandoned rows (last_seen_at older than 90 days) can be reaped by
-- a future cron; not added in this migration to keep the change
-- focused.

create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Raw session_id claim from the device's current access token.
  -- UUID-shaped, but stored as text because Supabase's auth.sessions
  -- table uses uuid and we keep this denormalized — no FK across
  -- schemas to avoid coupling our migration order to GoTrue's.
  session_id text not null,
  -- User-editable label. Defaults to an auto-generated string from
  -- user_agent (e.g. "Chrome on macOS") on first sync. The user can
  -- override from Settings.
  device_label text,
  -- Raw UA, kept so a future "regenerate label" feature has something
  -- to work from after a manual rename. Not surfaced in the UI.
  user_agent text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- One row per (user, session). Re-syncs from the same session
  -- just bump last_seen_at.
  unique (user_id, session_id)
);

create index if not exists user_devices_user_idx
  on public.user_devices (user_id);

-- No `set_updated_at` trigger here: the table's "freshness" is
-- represented by `last_seen_at`, which the application bumps
-- explicitly on each sync. The synced-table pattern uses
-- `updated_at` for last-writer-wins conflict resolution; this table
-- has no such concept since rows are owned by a single device.
-- RLS. Users see only their own devices. They can rename their own
-- rows (label is the only editable field) and insert their own rows
-- (the sync registration flow runs from the user's client). DELETE
-- is restricted to the user's own rows too: this lets a client
-- delete its own row pre-signOut without needing the service-role.
-- The "disconnect remote device" path goes through the admin route
-- which uses the service-role and bypasses RLS, so the user
-- self-DELETE policy is fine even with the 12h grace constraint
-- (the constraint is enforced application-side, not via RLS).
alter table public.user_devices enable row level security;

drop policy if exists "user_devices_read_own" on public.user_devices;
create policy "user_devices_read_own"
  on public.user_devices for select
  using (auth.uid() = user_id);

drop policy if exists "user_devices_insert_own" on public.user_devices;
create policy "user_devices_insert_own"
  on public.user_devices for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_devices_update_own" on public.user_devices;
create policy "user_devices_update_own"
  on public.user_devices for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_devices_delete_own" on public.user_devices;
create policy "user_devices_delete_own"
  on public.user_devices for delete
  using (auth.uid() = user_id);

-- Realtime publication — needed so the "forced sign-out" client
-- handler can react when its own row gets deleted by the admin
-- disconnect endpoint. Without this the client wouldn't know it had
-- been kicked until its next API call hit a 401.
alter publication supabase_realtime add table public.user_devices;

-- REPLICA IDENTITY FULL so DELETE events carry the full old row
-- (including session_id), not just the PK. The kicked-device
-- listener compares the deleted row's session_id against its own
-- to decide whether THIS browser was the one kicked; without the
-- full payload it would have to round-trip and could miss the
-- event window. The table is small and writes are rare, so the
-- WAL overhead is negligible.
alter table public.user_devices replica identity full;

-- Session invalidation RPC. The /api/devices/disconnect route calls
-- this with the service-role client to terminate a remote session at
-- the auth layer (deleting the user_devices row by itself only
-- removes the device from the list — without this, the kicked
-- device's refresh-token chain would survive and the user would be
-- silently signed back in on reload).
--
-- Wrapped in SECURITY DEFINER + an empty search_path so the function
-- runs with the owner's privileges (typically `postgres`, which has
-- auth-schema access in Supabase) but the caller doesn't need any
-- direct grants on the auth schema. Without `set search_path = ''`
-- a malicious schema with a same-named table could shadow the
-- intended `auth.*` resolution; the empty path forces the explicit
-- schema-qualified names below to mean exactly what they say.
--
-- Best-effort error handling: if the auth-side rows have already
-- been removed (sign-out from the device, prior cleanup) the deletes
-- are no-ops; we don't raise on missing rows.
create or replace function public.invalidate_user_session(
  target_session_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.refresh_tokens where session_id = target_session_id;
  delete from auth.sessions where id = target_session_id;
end;
$$;

-- Lock down execution: only the service-role (used by the disconnect
-- API route) may call this. Authenticated end-users mustn't be able
-- to terminate arbitrary sessions by RPC — the disconnect endpoint
-- enforces the 12-hour grace + ownership checks before calling.
revoke all on function public.invalidate_user_session(uuid) from public;
revoke all on function public.invalidate_user_session(uuid) from anon;
revoke all on function public.invalidate_user_session(uuid) from authenticated;
grant execute on function public.invalidate_user_session(uuid) to service_role;
