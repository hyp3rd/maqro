-- Outbound Web Push delivery log — one row per send attempt.
--
-- Drives the admin Engagement tile (sends today, expired
-- subscriptions reaped) and is the only mechanism we have for
-- visibility into push outcomes: the Web Push protocol has no
-- delivery callback, so we have to record the result of each send
-- ourselves at the moment we make the request. Subscription-side
-- events (notification click / close) would need a client-side
-- service-worker callback writing to a separate table — out of
-- scope for this migration; see "Phase B" in CONTRIBUTING.md when
-- it lands.
--
-- The table is high-volume by design (1 row × N subscriptions per
-- daily-reminder fire). The two indexes below cover the only two
-- query shapes we run: "stats for the last 24h" (admin home) and
-- "all sends for a specific user" (future per-user diagnostics).
-- Retention: a future cron can prune rows older than 90 days; not
-- added here so the migration stays focused on the table itself.

create table if not exists public.push_send_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The subscription row this attempt targeted. ON DELETE SET NULL
  -- so a log row survives the subscription it referenced — useful
  -- for the "how many expired today" stat, which by definition
  -- counts attempts whose subscription got deleted.
  subscription_id uuid references public.push_subscriptions(id) on delete set null,
  -- HTTP status returned by the push provider (201 on success,
  -- 410/404 when gone, etc.). Nullable because the send may have
  -- failed before we got a response (DNS, fetch throw).
  status_code int,
  -- One of: 'ok' | 'gone' | 'fail' | 'skipped'. Mirrors the
  -- discriminated union in `lib/push/send.ts:PushSendResult` plus
  -- 'skipped' for the VAPID-not-configured path.
  outcome text not null,
  -- Provider error body or library exception message. Stored
  -- verbatim for debugging; truncated to 1024 chars by the cron
  -- before insert so a verbose stack doesn't bloat the table.
  error text,
  -- The push payload's `tag` field — the daily reminder uses
  -- "daily-reminder" so the admin can filter by campaign as we add
  -- more.
  tag text,
  sent_at timestamptz not null default now()
);

create index if not exists push_send_log_sent_at_idx
  on public.push_send_log (sent_at desc);
create index if not exists push_send_log_user_idx
  on public.push_send_log (user_id);

alter table public.push_send_log enable row level security;

-- Service-role only. End users don't need to read their own
-- delivery log — the kicked-device behaviour (signOut + IDB wipe
-- when their row is deleted) is enough operational signal. The
-- admin dashboard reads via the service-role client which bypasses
-- RLS, so no policies are defined here.
