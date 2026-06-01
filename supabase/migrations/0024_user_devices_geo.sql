-- Richer detail on user_devices so the Settings → Signed-in devices
-- list can distinguish two "Chrome on macOS" sessions from each
-- other. Without IP / location / a more granular UA label, a user
-- with three laptops and a phone signed in over time sees four
-- identical rows and can't tell which one to disconnect.
--
-- Columns added:
--   - ip_address: capture-time IPv4/IPv6 of the device. Captured
--     server-side from the request headers in the new
--     /api/devices/register route (the client can't observe its
--     own egress IP reliably). Stored as text — Postgres has an
--     inet type but it adds operator surface we don't use, and
--     IPv6 normalization in PostgREST is awkward.
--   - geo_city / geo_country / geo_region: best-effort location
--     derived from Vercel's geo headers (`x-vercel-ip-city`,
--     `x-vercel-ip-country`, `x-vercel-ip-country-region`). All
--     nullable: on a non-Vercel deployment, on localhost, behind
--     certain corporate proxies, these may be blank. The UI hides
--     the location line when they're all null.
--
-- Privacy. IP + city/country are personal data under GDPR. Stored
-- here on the user's own request — they explicitly want to see
-- "where am I signed in from". Cleared on disconnect (the row goes
-- away) and on delete-account (the FK cascade). No third-party geo
-- service is involved: Vercel sets the headers from its edge
-- network, the value never leaves our request chain.

alter table public.user_devices
  add column if not exists ip_address text,
  add column if not exists geo_city text,
  add column if not exists geo_country text,
  add column if not exists geo_region text;

-- REPLICA IDENTITY FULL is already enabled (migration 0022) so the
-- forced-signOut listener gets the full deleted row, including these
-- new columns. No further changes needed there.
