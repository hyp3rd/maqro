-- Meal schedules: a recipe scheduled to one or more meal slots across a date
-- range + set of weekdays (the "cook once, log for…" meal-prep plan). The
-- client never writes future daily-log rows; it surfaces a one-tap "log it"
-- offer on each matching day instead. Mirrors the recipes table (0003) so the
-- existing local-first sync engine (push/pull + tombstones) handles it.

create table if not exists public.meal_schedules (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Snapshot of the recipe name at schedule time (list label; survives a rename).
  name text not null,
  -- The recipe applied on "log it". A schedule without its recipe is
  -- meaningless, so it cascades away with the recipe.
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  meal_names jsonb not null, -- string[] of target slot names (lower-cased)
  start_date text not null, -- YYYY-MM-DD
  end_date text not null, -- YYYY-MM-DD
  days_of_week jsonb not null, -- number[] 0=Sun..6=Sat
  scale numeric not null default 1,
  sort_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meal_schedules_user_idx on public.meal_schedules (user_id);

create index if not exists meal_schedules_recipe_idx on public.meal_schedules (recipe_id);

alter table public.meal_schedules enable row level security;

drop policy if exists "meal_schedules_owner_all" on public.meal_schedules;

create policy "meal_schedules_owner_all" on public.meal_schedules for all using (
  user_id = auth.uid ()
)
with
  check (user_id = auth.uid ());

drop trigger if exists meal_schedules_set_updated_at on public.meal_schedules;

create trigger meal_schedules_set_updated_at before update on public.meal_schedules for each row
execute function public.set_updated_at ();
