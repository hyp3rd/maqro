-- Recipe sharing — opt-in per recipe. A recipe is "shared" iff its
-- share_slug is non-null. Anyone (anon or authenticated) can read a
-- shared recipe by slug, which powers the public /r/[slug] page and
-- the "Import to my recipes" CTA for visitors who are signed in.
--
-- Privacy: nothing is public until the owner clicks Share. user_id
-- leaks through the read (it's part of the row), but it's an opaque
-- UUID with no actionable surface — we accept that trade in favor of
-- a simple RLS policy. If we ever need to hide it, swap this for a
-- SECURITY DEFINER function that returns only the safe columns.
--
-- Slug shape is 6–8 url-safe chars (handled client/server-side). The
-- unique index makes mint-with-retry cheap (rare collision → catch
-- unique_violation → regenerate).

alter table public.recipes
  add column if not exists share_slug text unique;

create index if not exists recipes_share_slug_idx
  on public.recipes (share_slug)
  where share_slug is not null;

-- Public read policy: anyone can SELECT a row when its share_slug is
-- set. The existing recipes_owner_all policy still gives owners full
-- access; this just opens a read-only window for shared rows.
-- NOTE: 0010 supersedes this policy (drops + replaces it with two
-- audience-scoped policies). It's kept here for historical accuracy
-- so a fresh-bootstrap apply produces a coherent intermediate state.
drop policy if exists "recipes_public_read_shared" on public.recipes;
create policy "recipes_public_read_shared"
  on public.recipes
  for select
  to anon, authenticated
  using (share_slug is not null);
