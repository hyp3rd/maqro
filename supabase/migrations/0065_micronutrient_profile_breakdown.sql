-- Macro-breakdown backfill on enrichment profiles.
--
-- The enrichment cron now resolves per-100g MACRO sub-values (sugars,
-- fiber, saturated/mono/poly fat) alongside the micronutrients, from the
-- same source (exact OFF product / CIQUAL / OFF search median / AI
-- estimate). Stored per profile so foods logged without OFF data still
-- get a breakdown on the meal sheet and the day totals.
--
-- jsonb, nullable: rows written before this migration simply have no
-- breakdown (the read side treats null as "not resolved yet").

alter table public.micronutrient_profiles
  add column if not exists breakdown jsonb;

comment on column public.micronutrient_profiles.breakdown is
  'Per-100g macro-breakdown values (sugars, saturatedFat, …) resolved by the enrichment cron from the same source as `values`. Null on pre-backfill rows.';
