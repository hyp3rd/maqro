-- Enable Supabase Realtime on every synced table.
--
-- Supabase Realtime relies on Postgres logical replication. Tables not
-- added to the `supabase_realtime` publication don't emit change events
-- to the WebSocket bridge, so client subscriptions silently see nothing.
--
-- The optimistic-concurrency check itself lives on the client: every
-- UPDATE adds `.eq("updated_at", baseUpdatedAt)`. Postgres evaluates
-- WHERE before the trigger, so the check sees the pre-update value;
-- the trigger then bumps it. A mismatch returns 0 rows updated, which
-- the client interprets as a conflict and re-pulls + reapplies.
--
-- Per-meal normalization (the proper fix for sub-day meal-slot
-- conflicts) lands in a separate migration so this PR stays scoped to
-- the silent-clobber bug.
--
-- IF NOT EXISTS isn't supported on `alter publication add table`, so
-- guard each one with a DO block.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daily_logs'
  ) then
    alter publication supabase_realtime add table public.daily_logs;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'weight_history'
  ) then
    alter publication supabase_realtime add table public.weight_history;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'custom_foods'
  ) then
    alter publication supabase_realtime add table public.custom_foods;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meal_templates'
  ) then
    alter publication supabase_realtime add table public.meal_templates;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recipes'
  ) then
    alter publication supabase_realtime add table public.recipes;
  end if;
end;
$$;
