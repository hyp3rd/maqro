-- Retire "Trust this device for 7 days" (0031) at the database layer.
--
-- The grant was keyed by (user_id, device_id), and the device_id was not a
-- secret: the owner SELECT policy below handed every row — device_id
-- included — to any session of that user, AAL1 included, and the cookie
-- carrying it was client-written. Anyone holding only the first factor
-- could read a trusted browser's id, plant it, and skip TOTP on every gate
-- that honoured the grant. The trust also cannot be expressed in RLS (it is
-- not in the JWT), so it was incompatible with enforcing the second factor
-- in the database (0079). The owner chose to retire the feature; the app no
-- longer reads, writes or lists these rows.
--
-- This migration takes end-user access away entirely: the owner read/delete
-- policies go, and `anon` / `authenticated` lose every table privilege, so
-- the Data API can neither read the stale device ids nor recreate a grant.
-- The table and its rows stay for now (the retention cron keeps draining
-- them via `trusted_until`, lib/retention.ts); a later release drops it.
--
-- Deployment: safe for the currently deployed app. Its trust lookup
-- (lib/auth/trusted-device.ts `findTrustedDeviceRowId`) collapses any error
-- to "not trusted", so the previous version fails CLOSED and simply asks
-- for the second factor; its Settings list shows an error until the new
-- version (which has no such section) is live. It ships with that new
-- version; the RLS enforcement in 0079 must wait until this release has
-- fully rolled out (see 0079's header).

drop policy if exists "mfa_trusted_devices_self_read"
  on public.mfa_trusted_devices;
drop policy if exists "mfa_trusted_devices_self_delete"
  on public.mfa_trusted_devices;

revoke all on table public.mfa_trusted_devices from anon, authenticated;

comment on table public.mfa_trusted_devices is
  'RETIRED (0078): the trusted-device MFA bypass was removed. No end-user access; kept only until a later release drops it.';
