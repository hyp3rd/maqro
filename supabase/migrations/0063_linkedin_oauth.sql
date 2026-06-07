-- Durable LinkedIn OAuth credentials for release publishing. A single row
-- (id is a boolean fixed to true) holding the AES-256-GCM-encrypted access +
-- refresh tokens, their expiries, and the organization URN. Admin/ops-only:
-- RLS enabled with NO policy, so only the service-role (the OAuth callback +
-- the publish route) can read or write. The token plaintext never lands here.

create table if not exists public.linkedin_oauth (
  -- Singleton guard: boolean PK fixed to true means at most one row exists.
  id boolean primary key default true,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  org_urn text not null,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkedin_oauth_single check (id)
);

alter table public.linkedin_oauth enable row level security;

drop trigger if exists linkedin_oauth_set_updated_at on public.linkedin_oauth;

create trigger linkedin_oauth_set_updated_at before update on public.linkedin_oauth for each row
execute function public.set_updated_at ();
