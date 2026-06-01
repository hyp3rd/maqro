-- Adds an explicit animal-vs-plant classification to custom_foods so the
-- meal planner's diet filter can respect user-tagged custom foods.
-- NULL means "not yet classified" — the client treats those as omnivore-only.
-- Allowed values are enforced application-side (FoodKind union in TypeScript).

alter table custom_foods
  add column if not exists diet_kind text;
