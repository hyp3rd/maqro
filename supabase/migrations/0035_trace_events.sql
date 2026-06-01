-- Per-user trace log — captures observability events for users
-- flagged via `profiles.traced` (migration 0033).
--
-- The trace flag was previously a gimmick: toggling it added a
-- column value but no caller actually USED it. This migration
-- + lib/admin-trace.ts + proxy.ts wiring turn the flag into a
-- real "tail this user" affordance:
--
--    - The proxy auto-logs every non-trivial API request from a
--      traced user (POST/PATCH/DELETE always; GETs only on 4xx/5xx).
--    - Significant actions can call `recordTraceEvent()` explicitly
--      from route handlers (admin actions, AI calls, sub changes).
--    - The user detail page surfaces the last N events in a panel
--      that only renders when `traced=true`.
--
-- Schema design notes:
--
--    - `kind` is a free-text discriminator ('http' | 'admin.action'
--      | 'ai.call' | future…). Not an enum so adding event types
--      doesn't need a migration. The column is indexed alongside
--      `user_id` for the hot "events for this user" lookup.
--    - `payload` is JSONB for kind-specific context. The
--      recorder is responsible for scrubbing sensitive fields
--      (the table's whole point is that PII is OK for traced
--      users, but tokens / passwords / secrets are NEVER ok).
--    - `created_at` is the retention anchor (90 days; see
--      lib/retention.ts).
--    - `duration_ms` + `status` are HTTP-flavoured but useful
--      enough for non-HTTP events that we leave them nullable
--      (e.g. an AI call's duration but no status).

create table if not exists public.trace_events (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Kind discriminator. See file header for the current values.
  kind text not null,
  created_at timestamptz not null default now(),
  -- HTTP fields. Nullable for non-HTTP events.
  method text,
  path text,
  status int,
  duration_ms int,
  -- Provenance / fingerprint. Same model as error_log.
  ip_address inet,
  user_agent text,
  -- Free-form kind-specific context. Caller is responsible for
  -- not stuffing secrets in here.
  payload jsonb
);

-- Hot path: "events for this user, newest first" — drives the
-- user-detail-page panel and any future per-user filter on the
-- trace surface.
create index if not exists trace_events_user_created_idx
  on public.trace_events (user_id, created_at desc);

-- Cross-user time-ordered scan (future "live trace feed" view).
-- Composite with `kind` so filtering by kind is also indexed.
create index if not exists trace_events_kind_created_idx
  on public.trace_events (kind, created_at desc);

alter table public.trace_events enable row level security;

-- Admins-only read. Cross-user visibility (an admin investigating
-- one user may want to compare against another). Users never see
-- their own trace rows — the flag is an admin observability tool,
-- not a self-service feature.
drop policy if exists "trace_events_admin_read"
  on public.trace_events;
create policy "trace_events_admin_read"
  on public.trace_events
  for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid()
        and profiles.role = 'admin'
    )
  );

-- No INSERT / UPDATE / DELETE policies — writes go through
-- service-role only via lib/admin-trace.ts. Retention purges
-- through the existing /api/cron/retention sweep.

comment on table public.trace_events is
  'Per-user observability log for users flagged via profiles.traced. Written by proxy.ts auto-capture and explicit recordTraceEvent() calls from route handlers. Read by /admin/users/[id]. 90-day retention via lib/retention.ts.';
