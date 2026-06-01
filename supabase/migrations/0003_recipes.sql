-- Recipes — user-named bundles of ingredients with optional cuisine + prep
-- notes. Ingredients are stored as a JSONB array (mirrors meal_templates.foods)
-- so the schema doesn't need a separate join table; the client already
-- handles aggregation. Diet compatibility is derived on the client from each
-- ingredient's dietKind snapshot — not stored — so it never drifts.

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  ingredients jsonb not null,         -- RecipeIngredient[]
  cuisine text,                       -- free-text, optional
  notes text,                         -- ≤500 chars (enforced client-side)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recipes_user_idx on public.recipes (user_id);

alter table public.recipes enable row level security;

drop policy if exists "recipes_owner_all" on public.recipes;
create policy "recipes_owner_all"
  on public.recipes
  for all
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

drop trigger if exists recipes_set_updated_at on public.recipes;
create trigger recipes_set_updated_at before update on public.recipes
  for each row execute function public.set_updated_at ();
