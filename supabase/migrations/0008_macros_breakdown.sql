-- Optional macro-breakdown fields surfaced by the OFF "where available"
-- rule: sugars + added sugars + fiber for carbs; saturated / trans /
-- mono- / poly-unsaturated for fat. All nullable on purpose — most
-- existing rows (seed catalog imports, custom foods saved before this
-- migration) don't have the data, and we render the breakdown only
-- when at least one source row actually populated a value.

alter table public.custom_foods
  add column if not exists sugars        double precision,
  add column if not exists added_sugars  double precision,
  add column if not exists fiber         double precision,
  add column if not exists saturated_fat double precision,
  add column if not exists trans_fat     double precision,
  add column if not exists mono_fat      double precision,
  add column if not exists poly_fat      double precision;
