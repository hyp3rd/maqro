-- Inbox triage: which inbound (Resend) messages the admin has archived. Resend's
-- received-emails API is read-only (list/get, no delete), so "archive" records
-- the message id here and the admin inbox view filters it out. Service-role only
-- (RLS on, no policy), like the other admin/ops tables.
create table if not exists public.inbox_dismissed (
  email_id text primary key,
  dismissed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.inbox_dismissed enable row level security;
