-- Track whether the user has already received the welcome email.
-- The /api/notifications/welcome route checks this column before
-- sending — if it's non-null, the route no-ops. That makes the
-- endpoint safe to call on every toggle-on (the client doesn't
-- have to track "is this the first opt-in?" — the server does).
--
-- We set the timestamp only AFTER a successful send. A failed
-- email send (Resend down, env missing, bad address) leaves the
-- column null so the next toggle-on retries. Without this, a
-- failed first attempt would permanently silence the welcome.

alter table public.notification_preferences
  add column if not exists welcome_sent_at timestamptz;
