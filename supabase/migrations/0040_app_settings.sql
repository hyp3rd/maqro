-- Generic admin-managed app settings. Started for the contact-form
-- receiver address (so ops can re-route /api/support to a different
-- inbox without a redeploy) — kept as a key/value table so future
-- runtime-configurable values (a webhook URL, a feature-flag default,
-- a maintenance banner string) can land here without another
-- migration.
--
-- Access pattern: writes go through the admin API; reads happen
-- server-side via a cached helper (lib/app-settings.ts) using the
-- service-role client. anon / authenticated clients never read this
-- directly — RLS is enabled with no policies, so a non-service-role
-- read returns zero rows even if someone discovers the table.

create table if not exists public.app_settings (
  key text primary key check (key = lower(key) and key ~ '^[a-z][a-z0-9_]*$'),
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.app_settings is
  'Admin-managed runtime settings (contact inbox, etc.). Reads + writes go through service-role; anon/authenticated have no RLS policy and get zero rows.';
comment on column public.app_settings.key is
  'Lowercase snake_case identifier. Convention enforced by CHECK.';

alter table public.app_settings enable row level security;
