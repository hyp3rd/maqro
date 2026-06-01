-- Server-side store for pantry inventory items. Mirrors the local
-- IDB store added in db.ts at v10.
--
-- One row per (user, client-minted UUID), same key strategy as
-- recipes / custom_foods so a row exists under the same id locally
-- and server-side with no mapping. Quantity is a free number; unit
-- is free text ("g", "eggs", "cans") — no unit-conversion engine in
-- v1, the user types whatever makes sense for the item.
--
-- name + quantity are required; note is optional. quantity is
-- bounded by a check (>= 0, < 1e6) to catch transposed-digit
-- mistakes without rejecting legitimate large counts.

create table if not exists public.pantry_items (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  quantity double precision not null check (quantity >= 0 and quantity < 1000000),
  unit text not null check (char_length(unit) <= 40),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pantry_items_user_idx
  on public.pantry_items (user_id);

-- RLS — same owner-only pattern as every other synced table.
alter table public.pantry_items enable row level security;

drop policy if exists "pantry_items_owner_all" on public.pantry_items;
create policy "pantry_items_owner_all"
  on public.pantry_items
  for all
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

-- updated_at trigger so the sync engine's last-write-wins comparison
-- sees a real timestamp on every server-side write.
drop trigger if exists pantry_items_set_updated_at on public.pantry_items;
create trigger pantry_items_set_updated_at
  before update on public.pantry_items
  for each row execute function public.set_updated_at ();

-- Realtime: emit change events so a second signed-in browser picks up
-- pantry edits live (same as recipes / custom_foods). IF NOT EXISTS
-- isn't supported on `alter publication add table`, so guard with a
-- DO block.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pantry_items'
  ) then
    alter publication supabase_realtime add table public.pantry_items;
  end if;
end $$;
