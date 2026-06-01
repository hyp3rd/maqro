-- Add an optional per-item "low stock" threshold to pantry items.
--
-- Stored in the item's own unit. When the quantity falls to/below
-- this, the bell fires and the row badges as "Low". Null means
-- "fall back to the global rule" (count items: at or below 1;
-- measured items: self-calibrating "can't repeat the last use").
-- Bounded `>= 0` so a meaningless negative can't sneak in.

alter table public.pantry_items
  add column if not exists low_threshold double precision
    check (low_threshold is null or low_threshold >= 0);
