-- "Trust this device for 7 days" — let users skip the second-factor
-- challenge on a known browser for a bounded window after a
-- successful MFA verify.
--
-- Security posture is the LOOSE variant: a trusted device entirely
-- skips the TOTP challenge until the trust expires (default 7
-- days), which materially weakens MFA on that device for that
-- window. The trade-off is consistent with how banks and SaaS apps
-- model "remember this device" — users self-select the convenience
-- vs strict-2FA spectrum, and the device-by-device revoke UX in
-- Settings (`TrustedDevicesSection`) makes the override visible
-- and reversible.
--
-- Lookup key is `(user_id, device_id)`. `device_id` is the
-- localStorage-persisted UUID from `lib/devices/identity.ts:
-- getOrCreateDeviceId()`, also used by `user_devices` since
-- migration 0028. Reusing that identifier means "trusted devices"
-- and "signed-in devices" can be cross-referenced in the UI later
-- if we want a unified "this device" view, without a second
-- fingerprinting mechanism.
--
-- We DO NOT bind the trust to IP/UA: IPs rotate (mobile ↔ wifi)
-- and UA strings drift across browser updates. The device_id +
-- session-bound HttpOnly cookies are the boundary; IP/UA are
-- recorded for the user's own Settings UI ("this looks like the
-- MacBook I trusted on Tuesday") but not used for trust validation.

create table if not exists public.mfa_trusted_devices (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Stable browser identifier — `lib/devices/identity.ts:DEVICE_ID_KEY`
  -- (`maqro:device-id:v1`). NOT a session identifier; survives sign-
  -- out + sign-in on the same browser.
  device_id text not null,
  -- When the trust was granted (= the moment the user passed MFA
  -- with the "Trust this device" box checked).
  trusted_at timestamptz not null default now(),
  -- When the trust expires. Default policy is 7 days from
  -- `trusted_at` enforced in the server route; this column is the
  -- ground truth so the trust check is a pure SQL comparison
  -- against `now()` — no clock arithmetic in app code.
  trusted_until timestamptz not null,
  -- Captured for the user-facing list. Not used for validation.
  user_agent text,
  ip_address inet,
  -- Pre-rendered "Chrome 123 on macOS 14.0" string from
  -- `inferDeviceLabel(userAgent)` so the Settings list doesn't have
  -- to re-derive on each render.
  device_label text,
  -- Bumped each time a trust-check succeeds against this row, so
  -- the Settings list can show "last used 2 hours ago" alongside
  -- "trusted 5 days ago". Helpful for spotting a row that's still
  -- active vs one that's just sitting unused.
  last_used_at timestamptz
);

-- One trust per (user, device) — re-trusting an already-trusted
-- device should refresh the existing row's `trusted_until` window
-- via UPSERT, not pile up duplicates.
create unique index if not exists mfa_trusted_devices_user_device_idx
  on public.mfa_trusted_devices (user_id, device_id);

-- Index supporting the hot path of the trust check: "is THIS device
-- trusted RIGHT NOW for THIS user". The `(user_id, trusted_until)`
-- composite lets the planner skip rows whose trust has already
-- expired (matched by retention or just stale).
create index if not exists mfa_trusted_devices_user_until_idx
  on public.mfa_trusted_devices (user_id, trusted_until);

alter table public.mfa_trusted_devices enable row level security;

-- Users may read their own rows. The Settings UI uses the cookie-
-- session client, which authenticates the user at AAL1; we don't
-- gate listing/revoking on AAL2 because the user has already
-- proven session ownership, and AAL2-gating would create a chicken-
-- and-egg loop where a user who lost their authenticator can't
-- revoke a trusted device without first verifying MFA on a trusted
-- device.
drop policy if exists "mfa_trusted_devices_self_read"
  on public.mfa_trusted_devices;
create policy "mfa_trusted_devices_self_read"
  on public.mfa_trusted_devices
  for select
  using (auth.uid() = user_id);

-- Users may delete their own rows (Settings: "Untrust this device"
-- / "Untrust all"). Same AAL rationale as above.
drop policy if exists "mfa_trusted_devices_self_delete"
  on public.mfa_trusted_devices;
create policy "mfa_trusted_devices_self_delete"
  on public.mfa_trusted_devices
  for delete
  using (auth.uid() = user_id);

-- No INSERT / UPDATE policies — writes go through the service-role
-- client in `/api/auth/mfa/trusted-devices` POST, which validates
-- that the caller's session is at AAL2 before recording the trust.
-- Allowing client-side INSERT would let an attacker who got the
-- AAL1 session forge a trust entry without ever passing MFA.
