-- Admin "session" tracking — bracket the period an operator is
-- actively inside /admin/* with a start + end event.
--
-- The `admin_audit_log` table already records WHAT admins do; this
-- table records the WHEN of presence: "Alice was in the admin
-- panel from 14:02 to 14:38 on Tuesday". Useful for compliance
-- reviews ("only Alice and Bob touched anything on that day"),
-- post-incident reconstruction ("who was looking around when
-- this happened?"), and identifying lingering sessions that
-- forgot to exit.
--
-- A "session" starts the first time the operator hits any
-- /admin/* page after a 30-minute gap of inactivity. It ends:
--   - explicitly: the operator clicks "Exit admin" → POST
--     /api/admin/session/end.
--   - implicitly: a later request notices the previous session
--     was idle > 30 min and closes it with reason='idle_timeout'
--     before opening a fresh one.
--   - on sign-out: today we don't get a hook into Supabase's
--     signOut(); the next admin sweep (or the next entry on a
--     different device) will close stale rows via the
--     idle-timeout path. The compromise is documented;
--     mechanically clean closure would require a custom
--     proxy.ts middleware hook on auth-state changes which is
--     out of scope here.
--
-- Each lifecycle transition also writes an admin_audit_log row
-- (action='admin.session.start' | 'admin.session.end'), so the
-- audit page surfaces it next to role changes / bans / etc.

create table if not exists public.admin_sessions (
  id uuid not null default gen_random_uuid() primary key,
  admin_user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  -- Updated on every /admin/* page render. Drives the idle-
  -- timeout heuristic.
  last_active_at timestamptz not null default now(),
  -- NULL while the session is still active; set when ended.
  ended_at timestamptz,
  -- 'manual' (Exit button) | 'idle_timeout' (30 min stale) |
  -- 'signout' (future: when we wire the auth listener). Free-text
  -- column rather than an enum so adding reasons later doesn't
  -- need a migration.
  ended_reason text,
  ip_address inet,
  user_agent text
);

-- Hot path: "find the open session for this admin" — used on
-- every /admin/* render to decide between touch + start. Partial
-- index on the open subset keeps the read tiny even with years
-- of historical sessions.
create index if not exists admin_sessions_open_idx
  on public.admin_sessions (admin_user_id, last_active_at desc)
  where ended_at is null;

-- Time-ordered list for the audit-style "session history" view.
create index if not exists admin_sessions_started_idx
  on public.admin_sessions (started_at desc);

alter table public.admin_sessions enable row level security;

-- Admins can read all sessions (their own + peers). Operators
-- need cross-visibility for "who else was in here" — limiting
-- to self-only would defeat half the point.
drop policy if exists "admin_sessions_admin_read"
  on public.admin_sessions;
create policy "admin_sessions_admin_read"
  on public.admin_sessions
  for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid()
        and profiles.role = 'admin'
    )
  );

-- No INSERT / UPDATE / DELETE policies — writes go through
-- service-role only via lib/admin-sessions.ts.

comment on table public.admin_sessions is
  'Bracket the periods an admin operator is active inside the admin panel. Driven by lib/admin-sessions.ts on every /admin/* page render. Lifecycle events also write to admin_audit_log under actions admin.session.{start,end}.';
