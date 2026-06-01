-- Server-side rate limiting for abuse-prone auth surfaces.
--
-- Without this, /api/account/backup-email/start, /api/auth/recovery,
-- and the OTP-verify routes accept unlimited requests per IP and
-- per email. The exposure scales with traffic:
--
--    - Email enumeration: hit /backup-email/start with candidate
--      addresses; the response time + side effects tell you which
--      ones are real users.
--    - Inbox spam at a victim: fire /auth/recovery in a loop with
--      a target email; victim's inbox fills with our recovery codes
--      until Resend quota burns out.
--    - OTP brute-force: fire /backup-email/verify with random codes
--      until one hits. Supabase rotates the OTP after a few wrong
--      attempts so the practical risk is small, but the noise itself
--      is a denial-of-service signal.
--
-- This migration adds a generic fixed-window throttle keyed by a
-- caller-supplied bucket (e.g. "backup-email:alice@example.com" or
-- "ip:203.0.113.42") plus a `security definer` function that does
-- the atomic check-and-increment in one statement. Callers reach
-- it via `supabase.rpc('check_throttle', {...})` in lib/rate-limit.ts.
--
-- The function is `security definer` so callers don't need direct
-- INSERT/UPDATE on the table — RLS-gated mutation isn't useful here
-- (the bucket key itself is the only authorization signal). Search
-- path is locked to `public, pg_temp` to prevent search-path
-- injection attacks against the function.

create table if not exists public.auth_throttle (
  bucket text not null primary key,
  -- Start of the current window. Reset by the function when the
  -- window expires.
  window_start timestamptz not null default now(),
  -- Number of requests observed in the current window. Reset to 1
  -- when window rolls over.
  count int not null default 1
);

-- Time-ordered cleanup index — used by the retention sweep to
-- drain stale entries. Most rows are stale within minutes (one-hour
-- windows × occasional callers).
create index if not exists auth_throttle_window_idx
  on public.auth_throttle (window_start);

alter table public.auth_throttle enable row level security;

-- No SELECT/INSERT/UPDATE/DELETE policies. All access goes through
-- the SECURITY DEFINER function below (which bypasses RLS) or via
-- the service-role retention sweep.

/** Atomic fixed-window rate-limit check. Returns whether the
 *  caller is allowed, the current count after the call, and a
 *  retry-after hint in seconds (0 when allowed).
 *
 *  Semantics:
 *    - First call for `p_bucket` → inserts with count=1, returns
 *      allowed=true.
 *    - Subsequent call within `p_window_seconds` of `window_start`
 *      AND under `p_limit` → increments, returns allowed=true.
 *    - Subsequent call within window but at/over `p_limit` → no
 *      increment, returns allowed=false + retry_after.
 *    - Subsequent call AFTER window expired → resets window_start
 *      and count, returns allowed=true.
 *
 *  Atomicity: the `for update` lock holds for the duration of the
 *  transaction, so concurrent callers serialize naturally. Worth
 *  the lock cost — undercounting due to race would defeat the
 *  whole point. */
create or replace function public.check_throttle(
  p_bucket text,
  p_limit int,
  p_window_seconds int
) returns table (allowed boolean, count int, retry_after_seconds int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_row public.auth_throttle%rowtype;
  v_window_end timestamptz;
begin
  select * into v_row from public.auth_throttle
    where bucket = p_bucket for update;

  if not found then
    insert into public.auth_throttle (bucket, window_start, count)
      values (p_bucket, v_now, 1);
    return query select true, 1, 0;
    return;
  end if;

  v_window_end := v_row.window_start + (p_window_seconds || ' seconds')::interval;

  -- Window expired → reset.
  if v_now >= v_window_end then
    update public.auth_throttle
      set window_start = v_now, count = 1
      where bucket = p_bucket;
    return query select true, 1, 0;
    return;
  end if;

  -- Within window, at or over limit → reject.
  if v_row.count >= p_limit then
    return query select
      false,
      v_row.count,
      greatest(1, extract(epoch from (v_window_end - v_now))::int);
    return;
  end if;

  -- Within window, under limit → increment.
  update public.auth_throttle
    set count = v_row.count + 1
    where bucket = p_bucket;
  return query select true, v_row.count + 1, 0;
end;
$$;

-- Allow the anon + authenticated + service_role to call the
-- function. The function itself doesn't expose any data; it just
-- returns boolean+count, so this is safe.
grant execute on function public.check_throttle(text, int, int) to anon;
grant execute on function public.check_throttle(text, int, int) to authenticated;
grant execute on function public.check_throttle(text, int, int) to service_role;

comment on function public.check_throttle(text, int, int) is
  'Atomic fixed-window rate-limit check. Called by lib/rate-limit.ts on abuse-prone routes (auth/recovery, backup-email/{start,verify}). SECURITY DEFINER so callers don''t need direct table access.';
