-- Promote three previously-notes-only fields on `recipes` into proper
-- columns:
--   - source_url      → set by the URL-import flow, lets us link back
--                       to the publisher and gate re-imports through
--                       the same SSRF + allowlist checks.
--   - servings        → integer denominator for the "scale to N
--                       servings" view-time control. Stored once at
--                       save and never mutated by the scaler — the
--                       canonical recipe is for `servings` people; the
--                       view multiplies for display.
--   - prep_time_minutes → total preparation time, integer minutes.
--                         Imported from schema.org totalTime
--                         (ISO 8601) or from the AI extractor.
--
-- All three are optional — pre-existing recipes (rebuilt manually, or
-- imported before this migration) have null values and the form
-- treats null as "not set". No backfill, no defaults.

alter table public.recipes
  add column if not exists source_url text,
  add column if not exists servings int,
  add column if not exists prep_time_minutes int;

-- Defensive CHECK constraints mirror the client-side validation so a
-- direct SQL insert (admin tools, migrations) can't smuggle in
-- malformed data and pollute the recipe surface. The HTTPS check
-- mirrors lib/recipe-import/fetch.ts's validateUrl — http:// URLs
-- shouldn't reach the column.
alter table public.recipes
  drop constraint if exists recipes_source_url_https_check,
  drop constraint if exists recipes_servings_positive_check,
  drop constraint if exists recipes_prep_time_nonneg_check;

alter table public.recipes
  add constraint recipes_source_url_https_check
    check (source_url is null or source_url ~ '^https://'),
  add constraint recipes_servings_positive_check
    check (servings is null or servings > 0),
  add constraint recipes_prep_time_nonneg_check
    check (prep_time_minutes is null or prep_time_minutes >= 0);

comment on column public.recipes.source_url is
  'Origin URL when the recipe was imported via /api/recipes/import-from-url. Always https:// when set; CHECK constraint enforces. Null for manually-entered recipes.';
comment on column public.recipes.servings is
  'How many people/portions this recipe makes. Used as the denominator for view-time scaling. Saved once; never mutated by the scaler.';
comment on column public.recipes.prep_time_minutes is
  'Total preparation time in minutes. Imported from schema.org totalTime (ISO 8601) or AI extraction.';
