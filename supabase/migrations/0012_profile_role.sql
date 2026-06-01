-- Role-based access for app managers. v1 has two roles:
--
--    'user'   — default. Hits the free-tier AI cap and pays.
--    'admin'  — bypasses the AI cap (treated as premium by the
--               usage helper) and gets future admin-only access
--               (user management, abuse review, etc., when those
--               UIs land).
--
-- This is the override the maintainer / staff / early-supporter
-- accounts need without touching the Stripe-driven `is_premium`
-- flag. Flipping a profile to admin happens manually via the
-- Supabase dashboard for now; a small CLI / admin route can come
-- later if managing >5 admins becomes painful.

alter table public.profiles
  add column if not exists role text not null default 'user'
  check (role in ('user', 'admin'));

-- Index purely for the admin-listing query we'll need eventually
-- (e.g. "show me all admins"). Partial so it doesn't waste space
-- indexing the overwhelmingly-common 'user' rows.
create index if not exists profiles_admin_role_idx
  on public.profiles (role)
  where role = 'admin';
