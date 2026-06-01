-- Trial-ending email idempotency stamp.
--
-- The /api/cron/trial-ending cron fires daily and emails users whose
-- Stripe trial converts to a paid subscription in 24-48 hours. We
-- need a column to mark "already nudged" so a daily cron doesn't
-- send the same email twice across consecutive fires when the window
-- overlaps.
--
-- Stored on profiles (1:1 with the subscription via stripe_subscription_id)
-- rather than its own table for the same reason 0016 stored billing
-- state there: small, derived, no separate lifecycle.
--
-- A null value means "no trial-ending email sent for the current
-- subscription". The webhook clears this back to null when a new
-- subscription is created (trial restart, replan, etc.) so a user
-- who starts a second trial later still gets the nudge.

alter table public.profiles
  add column if not exists trial_ending_email_sent_at timestamptz;
