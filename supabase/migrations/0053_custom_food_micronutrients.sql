-- Per-100g micronutrients on custom foods.
--
-- When a user saves an Open Food Facts result to their custom foods,
-- the product's vitamins/minerals/fiber now ride along (alongside the
-- sub-macros added in 0008). Stored as a single jsonb map
-- (nutrient key -> value in canonical unit) rather than ten columns,
-- to keep the table flat and let the tracked-nutrient set evolve
-- without a migration each time.
--
-- Nullable + defaulted to null: only OFF-imported custom foods carry
-- it; hand-entered foods and every pre-existing row stay null, which
-- the client reads as "unknown" (no micronutrient data for this food).

alter table public.custom_foods
  add column if not exists micronutrients jsonb;
