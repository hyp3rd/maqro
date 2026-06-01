-- Recipe sharing — visibility controls. Splits the original binary
-- "shared or not" into three lifecycle states the owner can flip
-- without minting/destroying the share URL:
--
--   'public'   — anyone with the link can view (anon + authenticated)
--   'members'  — only signed-in users can view; anon gets a sign-in CTA
--   'disabled' — link still exists but resolves to 404; re-enable later
--
-- Revoking (DELETE /api/recipes/[id]/share) still clears share_slug
-- entirely, so the URL stops working forever. Disabling preserves the
-- slug so the same URL works again when re-enabled.
--
-- NULL share_visibility means "legacy share row from before this
-- migration" — treat it as 'public' to preserve the existing behavior
-- of every link that was minted under 0009.

alter table public.recipes
  add column if not exists share_visibility text
    check (share_visibility in ('public', 'members', 'disabled'));

-- Backfill existing shared rows to 'public' so their semantics don't
-- change on deploy. Rows without a share_slug stay NULL — they're not
-- shared at all and the column has no meaning for them.
update public.recipes
  set share_visibility = 'public'
  where share_slug is not null and share_visibility is null;

-- Replace the single permissive read policy from 0009 with two
-- audience-scoped policies. RLS combines policies with OR, so the
-- owner's full-access policy (recipes_owner_all) still wins for the
-- owner's own rows regardless of visibility.
drop policy if exists "recipes_public_read_shared" on public.recipes;
drop policy if exists "recipes_anon_read_public_shared" on public.recipes;
drop policy if exists "recipes_auth_read_visible_shared" on public.recipes;

create policy "recipes_anon_read_public_shared"
  on public.recipes
  for select
  to anon
  using (
    share_slug is not null
    and coalesce(share_visibility, 'public') = 'public'
  );

create policy "recipes_auth_read_visible_shared"
  on public.recipes
  for select
  to authenticated
  using (
    share_slug is not null
    and coalesce(share_visibility, 'public') in ('public', 'members')
  );
