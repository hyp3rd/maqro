-- Server-side store for the user's favourite foods. Mirrors the local
-- IDB store added in db.ts at v15.
--
-- One row per (user, food). The `id` is a client-minted UUID shared
-- between IDB and Supabase. `name_key` is the lowercased food name — the
-- dedupe key so re-favouriting the same food can't create duplicates.
-- `food` is the addable per-100g food snapshot (name + macros +
-- micronutrients) stored as JSONB so re-adding needs no resolution;
-- `portion` is the default grams to add.

create table if not exists public.favorite_foods (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name_key text not null check (char_length(name_key) between 1 and 300),
  food jsonb not null,
  portion integer not null default 100 check (portion between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists favorite_foods_user_idx
  on public.favorite_foods (user_id);

-- One favourite per food per user (matches the local byNameKey dedupe).
create unique index if not exists favorite_foods_user_name_idx
  on public.favorite_foods (user_id, name_key);

-- RLS — same owner-only pattern as every other synced table.
alter table public.favorite_foods enable row level security;

drop policy if exists "favorite_foods_owner_all" on public.favorite_foods;
create policy "favorite_foods_owner_all"
  on public.favorite_foods
  for all
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

-- updated_at trigger so the sync engine's last-write-wins comparison
-- sees a real timestamp on every server-side write.
drop trigger if exists favorite_foods_set_updated_at on public.favorite_foods;
create trigger favorite_foods_set_updated_at
  before update on public.favorite_foods
  for each row execute function public.set_updated_at ();

-- Realtime: emit change events so favourites stay live across devices.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'favorite_foods'
  ) then
    alter publication supabase_realtime add table public.favorite_foods;
  end if;
end $$;
