-- Add an optional user-set store-aisle override to pantry items.
--
-- Pantry items auto-categorize from their name on the client (the
-- "shopping aisle" taxonomy: Produce, Dairy & Eggs, …). This column
-- lets the user correct a wrong guess (e.g. an item that auto-classed
-- as "Other") and have the correction sync across devices. Nullable:
-- null means "no override — derive from the name". Free text rather
-- than an enum so the client taxonomy can evolve without a migration;
-- the client validates the value against its known aisle set.

alter table public.pantry_items
  add column if not exists category text
    check (category is null or char_length(category) <= 40);
