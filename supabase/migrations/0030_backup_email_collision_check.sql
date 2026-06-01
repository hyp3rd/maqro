-- Guard against using another user's primary email as a backup.
--
-- The attack this closes: Alice configures Bob's primary email as
-- her backup (e.g., shared family inbox; Bob received the OTP and
-- read it to Alice). Alice's backup is now verified-against-Bob's-
-- inbox. Later, Alice (or anyone who controls Alice's session) can
-- trigger /api/auth/recovery and Supabase issues a magic-link for
-- Alice's account — delivered to Bob's inbox. Bob now has the keys
-- to Alice's account.
--
-- The migration adds a SECURITY DEFINER helper that the start route
-- calls via RPC: "is this email already an auth.users primary for
-- someone OTHER than the calling user?". If yes, we reject the
-- pending registration before any OTP is sent.
--
-- Why SECURITY DEFINER: auth.users isn't exposed through PostgREST
-- (security default), so a regular authenticated query can't read
-- it. The function runs with the function owner's privileges
-- (typically postgres / the service role) and returns just a
-- boolean — no row data leaks.
--
-- Why `set search_path = ''`: a search_path-hijack via a malicious
-- temp table named `auth.users` would otherwise let an attacker
-- mask the real table. Empty search_path forces fully-qualified
-- names inside the function body, which is what we use below.

create or replace function public.email_taken_by_other_user(
  candidate text,
  excluding_user uuid
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  -- Case-insensitive email match. Auth.users stores emails as
  -- already-lowercased (Supabase normalizes on signup), but we
  -- lower() both sides defensively in case that ever changes.
  select exists (
    select 1
    from auth.users
    where lower(email) = lower(candidate)
      and id <> excluding_user
  );
$$;

-- Authenticated callers can invoke this function. The return value
-- is a single boolean — no PII, no row data. The function itself
-- enforces the "exclude my own id" rule, so a caller can't probe
-- "is THIS specific email taken by THAT specific user" — they can
-- only ask "is this email in use by anyone but me?".
revoke all on function public.email_taken_by_other_user(text, uuid) from public;
grant execute on function public.email_taken_by_other_user(text, uuid)
  to authenticated, service_role;
