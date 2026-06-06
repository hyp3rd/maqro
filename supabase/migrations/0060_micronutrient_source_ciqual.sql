-- Allow `source = 'ciqual'` on micronutrient profiles.
--
-- The enrich-micronutrients cron now consults the ANSES-CIQUAL table for the
-- generic foods it covers (curated lab data, more reliable than the OFF
-- crowd-sourced median or an AI estimate) before falling back to the OFF name
-- search / AI. Those rows are tagged `'ciqual'`.

alter table public.micronutrient_profiles
  drop constraint if exists micronutrient_profiles_source_check;

alter table public.micronutrient_profiles
  add constraint micronutrient_profiles_source_check
  check (source in ('barcode', 'search', 'ciqual', 'ai', 'miss'));
