-- Status-probe history. One row per cron tick (every 5 minutes,
-- per vercel.json). The public /status page reads from here.
--
-- Privacy: no user data lands in this table. Each row records the
-- result of an unauthenticated GET to /api/health — overall ok flag,
-- per-dependency check status, latency, and the deployed version.
-- The probes are aggregate-only signals about platform health.
--
-- Retention: 90 days. A cleanup pass runs inside the cron handler
-- (cheaper than a separate scheduled DELETE — one fewer cron entry
-- and the cron is already touching this table).
--
-- Why not use auth.audit_log_entries or error_log: those tables
-- track *user-attributable* events. Status probes are unattributed
-- platform telemetry and would muddy the audit semantics.

create table if not exists public.status_probes (
  id bigserial primary key,
  probed_at timestamptz not null default now(),
  -- Overall health: true when every critical dependency reports ok.
  -- Matches the `ok` field in /api/health's response body.
  overall_ok boolean not null,
  -- Per-component status. Match the union returned by /api/health:
  --   'ok'      — dependency reachable
  --   'fail'    — dependency unreachable / errored
  --   'skipped' — dependency not configured on this deployment
  -- 'skipped' counts as healthy for the purposes of uptime % (the
  -- deployment isn't claiming to depend on this component).
  supabase_status text not null check (supabase_status in ('ok', 'fail', 'skipped')),
  stripe_status text not null check (stripe_status in ('ok', 'fail', 'skipped')),
  -- End-to-end probe latency in milliseconds. Helpful for spotting
  -- creeping slowness before it becomes a failure.
  response_ms integer not null check (response_ms >= 0),
  -- HTTP status code returned by /api/health. Belt-and-braces with
  -- overall_ok: a 503 with overall_ok=false matches; a 500 with
  -- overall_ok=true would be a bug worth investigating.
  http_status integer not null check (http_status >= 100 and http_status < 600),
  app_version text not null
);

comment on table public.status_probes is
  'Public health-probe history. Populated by /api/cron/status-probe every 5 minutes; read by /status.';

create index if not exists status_probes_probed_at_idx
  on public.status_probes (probed_at desc);

alter table public.status_probes enable row level security;

-- Public read policy. The /status page is unauthenticated, and the
-- row contents are intentionally non-sensitive (no user id, no IP,
-- no env values). Writes are restricted to service-role via no
-- policy on insert/update/delete.
create policy "Status probes are publicly readable"
  on public.status_probes
  for select
  to anon, authenticated
  using (true);
