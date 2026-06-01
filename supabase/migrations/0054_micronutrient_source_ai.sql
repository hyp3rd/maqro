-- Allow `source = 'ai'` on micronutrient profiles.
--
-- The enrichment cron now falls back to an AI estimate when Open Food
-- Facts has no match for a food name. Those rows are tagged `'ai'` so
-- the report can flag them as model estimates rather than product data.
-- Widen the existing CHECK constraint to admit the new value.

alter table public.micronutrient_profiles
  drop constraint if exists micronutrient_profiles_source_check;

alter table public.micronutrient_profiles
  add constraint micronutrient_profiles_source_check
  check (source in ('barcode', 'search', 'ai', 'miss'));
