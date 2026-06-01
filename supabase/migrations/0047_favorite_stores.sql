-- Server-side store for the user's favourite grocery stores. Mirrors
-- the local IDB store added in db.ts at v12.
--
-- One row per (user, OSM key). The `id` is the OpenStreetMap element
-- key the client mints ("<type>/<id>", e.g. "node/123"), shared between
-- IDB and Supabase so re-favouriting the same shop dedupes with no
-- mapping. We store a snapshot of the OSM fields at star-time (name,
-- kind, coordinates, optional address); favourites are not re-fetched
-- live. id is plain text (not a uuid) because it's an OSM key.

create table if not exists public.favorite_stores (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  kind text not null check (char_length(kind) <= 40),
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  address text check (address is null or char_length(address) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists favorite_stores_user_idx
  on public.favorite_stores (user_id);

-- RLS — same owner-only pattern as every other synced table.
alter table public.favorite_stores enable row level security;

drop policy if exists "favorite_stores_owner_all" on public.favorite_stores;
create policy "favorite_stores_owner_all"
  on public.favorite_stores
  for all
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

-- updated_at trigger so the sync engine's last-write-wins comparison
-- sees a real timestamp on every server-side write.
drop trigger if exists favorite_stores_set_updated_at on public.favorite_stores;
create trigger favorite_stores_set_updated_at
  before update on public.favorite_stores
  for each row execute function public.set_updated_at ();

-- Realtime: emit change events so favourites stay live across devices.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'favorite_stores'
  ) then
    alter publication supabase_realtime add table public.favorite_stores;
  end if;
end $$;
