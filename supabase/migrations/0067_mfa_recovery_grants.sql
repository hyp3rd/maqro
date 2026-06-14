-- One-time recovery grants: proof that a user reached the lost-authenticator
-- step-down THROUGH the backup-email recovery flow (clicking the link delivered
-- to their verified backup inbox), not merely by holding an AAL1 email-OTP
-- session.
--
-- SECURITY — why this gate exists: removing a verified TOTP factor normally
-- requires AAL2 (the second factor itself). The lost-authenticator case can't
-- satisfy that, so the unenroll runs with the service-role key. If a bare AAL1
-- session were sufficient to trigger it, anyone with email access alone could
-- strip two-step verification — defeating its entire purpose. The recovery grant
-- binds the unenroll to proof of BACKUP-inbox control: /api/auth/recovery mints
-- a random token, stores ONLY its sha256 here, and embeds the raw token in the
-- magic link sent to the backup address. /api/account/mfa/recover-unenroll
-- accepts the removal only when the caller presents the matching token AND an
-- authenticated session for the same user.
--
-- Like comp_grants (migration 0066): RLS is enabled with NO policies, so only
-- the service-role client (which bypasses RLS) can read or write. A user can
-- never see, forge, or enumerate a grant.

create table if not exists public.mfa_recovery_grants (
  -- sha256 (hex) of the raw recovery token. The raw token lives only in the
  -- emailed link; storing just the hash means a DB leak can't be replayed.
  token_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Short-lived: the grant is useless after this instant.
  expires_at timestamptz not null,
  -- Single-use: stamped when redeemed so a leaked link can't be replayed.
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mfa_recovery_grants_user_id_idx on public.mfa_recovery_grants (user_id);

alter table public.mfa_recovery_grants enable row level security;

-- Deliberately NO policies: only the service-role client may touch this table.
