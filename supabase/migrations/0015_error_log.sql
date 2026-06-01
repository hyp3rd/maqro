-- Privacy-preserving client + server error log.
--
-- Design intent: capture enough to debug ("the meal-plan route is
-- 500ing for 12 users on Chrome 130"), but not enough to identify
-- a specific user. No user_id, no email, no IP — just an anonymous
-- session token the maintainer can use to correlate consecutive
-- events from the same tab during a single triage session, never
-- across sessions.
--
-- Writes go through the service-role client in /api/errors. RLS
-- denies everything else, including authenticated reads — only the
-- maintainer (via Supabase Studio or the future admin dashboard)
-- should see these rows.
create table if not exists public.error_log (
  id uuid not null default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),
  -- The bundled APP_VERSION at the time the error fired. Lets us
  -- correlate a sudden uptick in errors with a specific deploy.
  app_version text,
  -- The page or API route the error happened on. "global" for
  -- top-level unhandled rejections that don't have a clear origin.
  route text,
  -- 'error' for thrown exceptions / 4xx-5xx; 'warning' for
  -- recoverable degradations we want visibility into without
  -- pager-style noise.
  level text not null default 'error' check (level in ('error', 'warning')),
  message text not null,
  stack text,
  user_agent text,
  -- Rotates per browser session (sessionStorage-backed), never
  -- persisted server-side beyond the row itself. Lets us see
  -- "these 4 errors are all the same tab" without identifying
  -- *which* tab.
  session_token text,
  -- Free-form structured context the caller can attach (form name,
  -- the HTTP status from a failed fetch, the request shape, etc.).
  -- Stripped of identifiers by the caller — never raw user input.
  context jsonb
);

-- Index supports the "tail recent errors" query the admin
-- dashboard will run. Date-descending so the planner uses the
-- index for the common "last 100" path.
create index if not exists error_log_created_at_idx
  on public.error_log (created_at desc);

-- Allow filtering by level (e.g. errors-only triage) without a
-- full scan.
create index if not exists error_log_level_created_at_idx
  on public.error_log (level, created_at desc);

alter table public.error_log enable row level security;

-- No policies. RLS denies by default; only the service-role key
-- can read/write. The ingest route uses the service-role client
-- to bypass RLS, and the (future) admin dashboard does the same
-- after verifying the caller's admin role server-side.
drop policy if exists "error_log_no_access" on public.error_log;
