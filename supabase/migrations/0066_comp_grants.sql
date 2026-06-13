-- Complimentary tier grants: an admin can grant a user Plus/Pro entitlement
-- WITHOUT a Stripe subscription (comps, partnerships, support make-goods,
-- staff-adjacent access). Read by the entitlement path (resolveTier) the same
-- way `profiles.is_grandfathered` is — a non-billing grant with an optional
-- expiry.
--
-- SECURITY — why a separate table, not a `profiles` column: a comp grant is a
-- paid-feature bypass, so a user must never be able to set it on themselves.
-- This table has RLS enabled with ONLY an owner-SELECT policy and NO
-- insert/update/delete policy, so the owning user can READ their grant (the
-- entitlement check runs with the user's RLS client and needs to see it) but
-- only the service-role admin route — which bypasses RLS — can WRITE it. That
-- is safe by construction regardless of the profiles table's own policies.

create table if not exists public.comp_grants (
  -- One active grant per user; granting again overwrites (upsert on the PK).
  user_id uuid primary key references auth.users (id) on delete cascade,
  tier text not null check (tier in ('plus', 'pro')),
  -- null = indefinite (until an admin revokes). A past timestamp = expired;
  -- resolveTier stops honoring the grant after it (the row stays for audit).
  expires_at timestamptz,
  -- Who granted it (admin user id). Set null if that admin is later deleted so
  -- the grant itself survives the actor.
  granted_by uuid references auth.users (id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.comp_grants enable row level security;

-- Owner may READ their own grant so the entitlement read path (which runs with
-- the user's session client) resolves their tier. Deliberately no write
-- policy: writes come only from the service-role admin route, which bypasses
-- RLS — a user can never self-grant.
drop policy if exists "comp_grants_owner_read" on public.comp_grants;

create policy "comp_grants_owner_read" on public.comp_grants for
select
  using (user_id = auth.uid ());

drop trigger if exists comp_grants_set_updated_at on public.comp_grants;

create trigger comp_grants_set_updated_at before update on public.comp_grants for each row
execute function public.set_updated_at ();
