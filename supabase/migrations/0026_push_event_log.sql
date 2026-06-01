-- Service-worker callback log — one row per notification click /
-- close. Pairs with `push_send_log` (sent attempts) to compute the
-- real CTR: clicks ÷ sends over a time window. Without this table
-- we only know what we tried to deliver; with it we know what
-- actually landed and got attention.
--
-- Why a separate table from push_send_log:
--   - 1:N relationship. A single send can have at most one click,
--     and may also be followed by a close — but never the reverse.
--     Splitting keeps each row a single immutable event.
--   - Different write source. push_send_log is written by the cron
--     (service-role); push_event_log is written by the service
--     worker (cookie-auth, anon role) — different RLS posture.
--   - Different retention. We may want long-tail event history
--     for cohort analysis even after the originating sends roll out.
--
-- Identification model. The service worker doesn't know the
-- push_send_log row's id — push providers don't carry custom IDs
-- through the encrypted payload reliably across all OSes. Instead,
-- we key events to a `tag` ("daily-reminder", etc.) plus the
-- caller's user_id from the cookie session. Stats aggregate by
-- (user, tag, window) which is the granularity that matters for
-- "what's our CTR on the daily reminder this week?"

create table if not exists public.push_event_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 'click' = user tapped the notification (notificationclick fired
  -- in the SW). 'close' = dismissed without click (notificationclose
  -- fired; not reliably supported on iOS Safari PWAs, so this count
  -- is lower-bound only on mobile).
  event text not null check (event in ('click', 'close')),
  -- Notification tag from the originating payload — matches the
  -- `tag` column on push_send_log so joins / aggregates are
  -- straightforward.
  tag text,
  created_at timestamptz not null default now()
);

create index if not exists push_event_log_created_idx
  on public.push_event_log (created_at desc);
create index if not exists push_event_log_user_idx
  on public.push_event_log (user_id);

alter table public.push_event_log enable row level security;

-- Users may insert their own click / close events from the service
-- worker (cookie-auth). They cannot read other people's events; the
-- admin dashboard reads via service-role and bypasses RLS.
drop policy if exists "push_event_log_insert_own"
  on public.push_event_log;
create policy "push_event_log_insert_own"
  on public.push_event_log for insert
  with check (auth.uid() = user_id);

drop policy if exists "push_event_log_read_own"
  on public.push_event_log;
create policy "push_event_log_read_own"
  on public.push_event_log for select
  using (auth.uid() = user_id);
