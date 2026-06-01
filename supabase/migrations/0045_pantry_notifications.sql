-- Server-side store for pantry notifications. Mirrors the local IDB
-- store added in db.ts at v11.
--
-- One row per (user, client-minted UUID). Currently only the
-- "low-stock" kind — fired when consuming a recipe pushes a pantry
-- item to/below its low-stock threshold. `item_id` references the
-- pantry row but is NOT a hard FK with cascade: a notification is a
-- historical event that stays valid even if the user later edits or
-- deletes the underlying item, so we keep it as a plain uuid column.
-- `read` toggles when the user opens the notifications drawer.

create table if not exists public.pantry_notifications (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('low-stock')),
  item_id uuid not null,
  item_name text not null check (char_length(item_name) between 1 and 200),
  quantity double precision not null,
  unit text not null check (char_length(unit) <= 40),
  read boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pantry_notifications_user_idx
  on public.pantry_notifications (user_id);

-- RLS — same owner-only pattern as every other synced table.
alter table public.pantry_notifications enable row level security;

drop policy if exists "pantry_notifications_owner_all" on public.pantry_notifications;
create policy "pantry_notifications_owner_all"
  on public.pantry_notifications
  for all
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

-- updated_at trigger so the sync engine's last-write-wins comparison
-- sees a real timestamp on every server-side write.
drop trigger if exists pantry_notifications_set_updated_at on public.pantry_notifications;
create trigger pantry_notifications_set_updated_at
  before update on public.pantry_notifications
  for each row execute function public.set_updated_at ();

-- Realtime: emit change events so the bell's unread badge stays live
-- across the user's signed-in devices.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pantry_notifications'
  ) then
    alter publication supabase_realtime add table public.pantry_notifications;
  end if;
end $$;
