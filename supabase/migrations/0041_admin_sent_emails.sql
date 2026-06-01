-- Admin-driven outgoing email log. Resend's API doesn't expose
-- "list emails I sent" — only "get one by id" — so we need our own
-- record to drive the /admin/inbox/outgoing list view.
--
-- Each row is created at send-time by the admin send route and
-- carries enough to render the list (to, subject, status, who sent
-- it) without a Resend round-trip. The detail page enriches with a
-- live `GET /emails/{id}` for the freshest delivery state.
--
-- Access pattern: service-role-only. The admin API gates writes via
-- requireAdmin(); reads go through the same gate. RLS enabled with
-- no policies so anon/authenticated read returns zero rows.

create table if not exists public.admin_sent_emails (
  -- Resend's email id. We use it as our primary key so the GET +
  -- cancel routes can route directly without a join.
  id text primary key,
  -- The admin who issued the send. References auth.users so cascade
  -- deletes correctly tear down the row if the admin's account is
  -- removed (orphans aren't useful for audit purposes — the audit
  -- log keeps a parallel record).
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  -- Recipient addresses. Stored as text[] so multi-recipient sends
  -- aren't lossy. Validated upstream at the route layer.
  recipients text[] not null check (array_length(recipients, 1) > 0),
  subject text not null,
  -- When this send was a reply to a received inbound message, the
  -- inbound's id goes here so the UI can backlink. Nullable for
  -- standalone composes.
  in_reply_to text,
  -- Scheduled-send time. NULL for immediate sends. Used by the
  -- list view to distinguish "scheduled" from "sent now"; the
  -- live status from Resend is the source of truth for whether
  -- it's been dispatched.
  scheduled_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.admin_sent_emails is
  'Admin outgoing email log. One row per Resend send issued from /admin/inbox. Reads + writes are service-role-only.';
comment on column public.admin_sent_emails.id is
  'Resend email id. Acts as the primary key so detail/cancel routes can address by id directly.';

create index if not exists admin_sent_emails_admin_created_idx
  on public.admin_sent_emails (admin_user_id, created_at desc);
create index if not exists admin_sent_emails_created_idx
  on public.admin_sent_emails (created_at desc);

alter table public.admin_sent_emails enable row level security;
-- Intentionally no policies. All access flows through the
-- service-role admin client (gated by requireAdmin() at the route).
