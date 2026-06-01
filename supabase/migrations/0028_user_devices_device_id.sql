-- Stable per-browser device identity for the user_devices list.
--
-- Until this migration, "device" was identified by the Supabase
-- access-token `session_id` JWT claim — a value that rotates on
-- every sign-in. That meant signing out + in on the same browser
-- created a new row each time, with no way to distinguish it from
-- a row created by a different physical device (same UA, same IP,
-- same geo). The Signed-in devices list in Settings became an
-- ever-growing collection of duplicates.
--
-- This migration introduces `device_id`: a client-generated UUID
-- persisted in localStorage on first sign-in for a given browser.
-- It's stable across sign-in cycles, so re-syncs on the same
-- browser hit the UPDATE branch in /api/devices/register instead
-- of the INSERT branch.
--
-- Why nullable: existing rows (created before this migration) have
-- no device_id. We leave them as NULL rather than trying to
-- back-derive an identity from user_agent + IP — that heuristic is
-- too easy to get wrong in office/NAT/VPN setups. Users can clear
-- the historical clutter via the new "Disconnect all other
-- sessions" button in Settings, and the next sign-in on each
-- browser backfills its row's `device_id`.
--
-- Why a partial unique index (not a plain UNIQUE constraint): PG
-- allows multiple NULLs in a unique constraint by default, so a
-- plain `unique (user_id, device_id)` would do the right thing for
-- our case. We use a partial index explicitly for clarity — it
-- documents the invariant ("uniqueness applies once a device_id is
-- set") and avoids any future confusion if Postgres's NULL
-- handling in unique constraints ever shifts.
--
-- The existing `unique (user_id, session_id)` constraint from
-- migration 0022 stays. It's now informational for new rows (every
-- sign-in produces a fresh session_id) and still backstops dedup
-- for legacy clients that aren't yet sending device_id.

alter table public.user_devices
  add column if not exists device_id text;

create unique index if not exists user_devices_user_device_idx
  on public.user_devices (user_id, device_id)
  where device_id is not null;

-- Lookup index for the new device-id-first path in
-- /api/devices/register. The composite (user_id, device_id) above
-- already covers point lookups, so no separate single-column index
-- is needed.
