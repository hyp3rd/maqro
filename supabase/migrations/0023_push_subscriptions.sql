-- Web Push subscriptions — one row per (user, push endpoint).
--
-- The browser's PushManager produces a subscription object shaped:
--   { endpoint, keys: { p256dh, auth } }
-- which is opaque per-browser-install: signing in on a second browser
-- creates a separate subscription, and a single user can have many.
-- We store every one so the daily-reminder cron can fan out to every
-- device the user has opted in on.
--
-- Endpoint is the unique identifier per push provider (Mozilla,
-- Apple, Google FCM, etc.) — used as the upsert key so re-subscribing
-- on the same browser is idempotent (the SDK sometimes returns a new
-- subscription object with the same endpoint after permission re-grant).
--
-- p256dh / auth are the ECDH key + secret needed to encrypt the
-- payload before sending. They're stored verbatim and only ever
-- consumed server-side by the `web-push` library — never exposed
-- to any other client.
--
-- Cleanup. Rows are deleted explicitly when:
--   - the user toggles push off in Settings, or
--   - the push provider returns a 404 / 410 from a send (the
--     subscription is gone on their end — we prune ours to match).
-- The daily-reminder cron handles the second case inline.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now (),
  last_seen_at timestamptz not null default now (),
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Owner-only access. The cron reads ACROSS users via service-role
-- and bypasses RLS; these policies are for the user's own
-- subscribe / unsubscribe flow from the Settings UI.
drop policy if exists "push_subscriptions_owner_select"
  on public.push_subscriptions;
create policy "push_subscriptions_owner_select"
  on public.push_subscriptions for select
  using (auth.uid () = user_id);

drop policy if exists "push_subscriptions_owner_insert"
  on public.push_subscriptions;
create policy "push_subscriptions_owner_insert"
  on public.push_subscriptions for insert
  with check (auth.uid () = user_id);

drop policy if exists "push_subscriptions_owner_update"
  on public.push_subscriptions;
create policy "push_subscriptions_owner_update"
  on public.push_subscriptions for update
  using (auth.uid () = user_id)
  with check (auth.uid () = user_id);

drop policy if exists "push_subscriptions_owner_delete"
  on public.push_subscriptions;
create policy "push_subscriptions_owner_delete"
  on public.push_subscriptions for delete
  using (auth.uid () = user_id);

-- Boolean opt-in for the push channel. Distinct from `daily_reminder`
-- (the email channel) so a user can enable one without the other —
-- e.g. push on a phone where they want immediate nudges, email off
-- because the inbox is noise. Default false: never push without
-- explicit consent.
alter table public.notification_preferences
  add column if not exists push_enabled boolean not null default false;
