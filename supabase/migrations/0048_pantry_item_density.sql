-- Add an optional density (g/ml) to pantry items.
--
-- Volume-unit items (ml, l, cup, tbsp…) reconcile a recipe's grams into
-- a volume on the client by dividing grams by this density, then by the
-- unit's millilitres. Null means "use the ~1 g/ml water default". Only
-- meaningful for volume units; ignored for mass/count units. Bounded
-- > 0 so a stray 0 can't divide-by-zero on the client (the client also
-- guards, but defend at the column).

alter table public.pantry_items
  add column if not exists density double precision
    check (density is null or density > 0);
