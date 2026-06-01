-- Lost-email recovery: a verified backup contact address that the
-- account-recovery flow can dispatch a Supabase magic-link to when
-- the primary email is unreachable.
--
-- Storage lives on `profiles` (not a separate table) because the
-- relationship is strictly 1:1 with the user and every recovery-
-- relevant column joins to the same row. A separate table would
-- just add a JOIN on the hot path.
--
-- Columns:
--   - backup_email:                The verified backup address. NULL
--                                  when the user hasn't set one or
--                                  has cleared it. Recovery only
--                                  works when this is non-null AND
--                                  `backup_email_verified_at` is non-
--                                  null — the two are written
--                                  together in the verify route.
--
--   - backup_email_verified_at:    When the OTP was confirmed.
--                                  Recovery checks for non-null.
--
--   - backup_email_pending:        Candidate that hasn't been
--                                  confirmed yet. Overwritten on
--                                  every "send code" request so a
--                                  typo doesn't lock the user out;
--                                  promoted to `backup_email` on
--                                  successful verify.
--
--   - backup_email_code_hash:      SHA-256 hex of the 6-digit OTP.
--                                  Storing the hash (not the code)
--                                  means a DB read by a service-role
--                                  client never returns the raw OTP.
--
--   - backup_email_code_expires_at: 10-minute TTL on the OTP. Verify
--                                  route rejects expired codes.
--
-- We deliberately do NOT enforce uniqueness on `backup_email` —
-- two users can share a backup (a couple, a family) and the
-- recovery route disambiguates by also matching the primary email.

alter table public.profiles
  add column if not exists backup_email text,
  add column if not exists backup_email_verified_at timestamptz,
  add column if not exists backup_email_pending text,
  add column if not exists backup_email_code_hash text,
  add column if not exists backup_email_code_expires_at timestamptz;

-- Index for the recovery lookup. Recovery queries are
-- `WHERE backup_email = ? AND backup_email_verified_at IS NOT NULL`,
-- so a partial index on the verified rows is cheaper than a plain
-- index that includes every NULL.
create index if not exists profiles_backup_email_idx
  on public.profiles (backup_email)
  where backup_email_verified_at is not null;
