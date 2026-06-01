-- Admin-managed allowlist for the recipe-import-from-URL feature.
--
-- Semantics — IMPORTANT:
--   • Empty table  → allow ANY public hostname (the SSRF defenses
--     in lib/recipe-import/fetch.ts and lib/recipe-import/safe-agent.ts
--     are the only gates).
--   • Non-empty   → restrict-mode: only hostnames present in the
--     table (or their subdomains, see lib/recipe-import/host-allowlist.ts)
--     can be imported. Everything else is rejected by the route as 422.
--
-- The optional posture means an admin can tighten the surface to a
-- known-good set of recipe publishers when warranted (post-incident,
-- B2B deployment with stricter requirements, etc.) without forcing
-- every deployment to maintain a list from day one.
--
-- Access pattern: reads and writes both go through the admin API
-- (/api/admin/recipe-import-allowlist), which uses the service-role
-- client under requireAdmin() — same pattern as every other admin
-- table in this codebase. No RLS policies needed: the table has no
-- meaningful access from non-service-role contexts (anon/authenticated
-- never read it directly — the import route also uses service-role to
-- avoid a per-request RLS check on the hot path).

create table if not exists public.recipe_import_host_allowlist (
  -- Lowercased hostname, no scheme, no path, no port.
  -- An entry "example.com" matches both "example.com" and any
  -- subdomain ("blog.example.com"). The subdomain match is in the
  -- application-layer check function (lib/recipe-import/host-allowlist.ts),
  -- not at the SQL level, so the table stays simple.
  hostname text primary key check (hostname = lower(hostname) and hostname !~ '[/:?#]'),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

comment on table public.recipe_import_host_allowlist is
  'Optional admin-managed list of hostnames the recipe-import-from-URL feature is allowed to fetch. Empty table = no restriction (defaults apply); non-empty = restrict-mode. Each entry matches itself and all subdomains.';
comment on column public.recipe_import_host_allowlist.hostname is
  'Lowercased bare hostname (no scheme/path/port). Subdomain match is applied in app code.';
comment on column public.recipe_import_host_allowlist.note is
  'Optional human-readable note explaining why this host was added (e.g. "Approved by ops 2026-05-23, primary recipe publisher").';

-- Defense in depth: even though we don't expose RLS-readable access,
-- enable RLS with no policies. anon/authenticated clients then get
-- zero rows back if they somehow reach this table, instead of the
-- full list. Service-role bypasses RLS so the route works as usual.
alter table public.recipe_import_host_allowlist enable row level security;
