-- Track which transactional billing emails have been sent so the
-- webhook handler can stay idempotent across Stripe redeliveries +
-- restarts. Each stamp is set on send and cleared when the
-- underlying state cycles (e.g. cancellation → resume → cancel again
-- should re-send the cancellation confirmation).
--
-- Why DB-stamps and not webhook-event-id idempotency: the
-- stripe_webhook_events table already dedups by event id, but a
-- subscription's lifecycle can fire many `customer.subscription.updated`
-- events for the same logical state (Stripe will re-fire on metadata
-- changes, price changes, anything). We don't want one cancellation
-- to send N "we've cancelled your subscription" emails. The DB stamp
-- is the per-user, per-logical-state guard.

alter table public.profiles
  add column if not exists subscription_confirmed_email_sent_at timestamptz,
  add column if not exists cancellation_email_sent_at timestamptz,
  add column if not exists payment_failed_email_sent_at timestamptz;

comment on column public.profiles.subscription_confirmed_email_sent_at is
  'When we sent the "welcome, you''re subscribed" confirmation. Set on checkout.session.completed (subscription mode, active/trialing). Cleared on subscription end so a fresh re-subscribe sends a new confirmation.';

comment on column public.profiles.cancellation_email_sent_at is
  'When we sent the cancellation confirmation. Set when cancel_at_period_end transitions to true. Cleared on resume (cancel_at_period_end → false) so a future cancel re-confirms.';

comment on column public.profiles.payment_failed_email_sent_at is
  'When we sent the dunning-final notice. Set on invoice.payment_failed when next_payment_attempt is null (Stripe gave up retrying). Cleared on a successful payment so a future dunning cycle gets its own notice.';
