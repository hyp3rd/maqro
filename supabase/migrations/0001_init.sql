-- Schema for the macro-calculator. One row per (user, key) with RLS so
-- users only see their own rows. All tables track `updated_at` for
-- last-write-wins conflict resolution during sync.

create extension if not exists "pgcrypto";

-- ─── profiles ──────────────────────────────────────────────────────────────
-- One row per user. The `payload` is the full PersonalInfo object so adding
-- profile fields doesn't require schema changes — this is a personal app,
-- not analytics, so a JSON blob is the right ergonomic tradeoff.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

-- ─── daily_logs ────────────────────────────────────────────────────────────
-- (user, YYYY-MM-DD) → meals array. Date is a text key rather than `date`
-- so it round-trips identically to what the client uses (no timezone games
-- when shipping rows back and forth).
create table if not exists public.daily_logs (
  user_id uuid not null references auth.users (id) on delete cascade,
  date text not null check (date ~ '^\d{4}-\d{2}-\d{2}$'),
  meals jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- ─── weight_history ────────────────────────────────────────────────────────
create table if not exists public.weight_history (
  user_id uuid not null references auth.users (id) on delete cascade,
  date text not null check (date ~ '^\d{4}-\d{2}-\d{2}$'),
  kg double precision not null check (kg > 0 and kg < 500),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- ─── custom_foods ──────────────────────────────────────────────────────────
-- The local IDB autoincrements id; in Postgres we use a UUID so multiple
-- devices can mint ids without colliding. The local id stays in IDB for
-- in-memory references; the cloud row carries a separate `id`.
create table if not exists public.custom_foods (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  protein double precision not null default 0,
  carbs double precision not null default 0,
  fat double precision not null default 0,
  calories double precision not null default 0,
  brand text,
  category text,
  sub_category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists custom_foods_user_idx on public.custom_foods (user_id);

-- ─── meal_templates ────────────────────────────────────────────────────────
create table if not exists public.meal_templates (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  foods jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meal_templates_user_idx on public.meal_templates (user_id);

-- ─── RLS ───────────────────────────────────────────────────────────────────
-- Same policy on every table: a row is visible (and writable) only by its
-- owner. `auth.uid()` returns the JWT's `sub` claim, which is the user_id.

alter table public.profiles enable row level security;
alter table public.daily_logs enable row level security;
alter table public.weight_history enable row level security;
alter table public.custom_foods enable row level security;
alter table public.meal_templates enable row level security;

-- `create policy if not exists` requires Postgres 16+. Use the
-- drop-then-create pattern so the migration is idempotent on every
-- supported Postgres version.
drop policy if exists "profiles_owner_all" on public.profiles;
create policy "profiles_owner_all"
  on public.profiles
  for all
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

drop policy if exists "daily_logs_owner_all" on public.daily_logs;
create policy "daily_logs_owner_all"
  on public.daily_logs
  for all
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

drop policy if exists "weight_history_owner_all" on public.weight_history;
create policy "weight_history_owner_all"
  on public.weight_history
  for all
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

drop policy if exists "custom_foods_owner_all" on public.custom_foods;
create policy "custom_foods_owner_all"
  on public.custom_foods
  for all
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

drop policy if exists "meal_templates_owner_all" on public.meal_templates;
create policy "meal_templates_owner_all"
  on public.meal_templates
  for all
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

-- ─── updated_at triggers ───────────────────────────────────────────────────
-- Bump `updated_at` on every UPDATE so client-side sync can do last-write-
-- wins by comparing timestamps. Servers shouldn't trust client-set
-- timestamps anyway.

create or replace function public.set_updated_at ()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Triggers don't support `if not exists`. The drop-then-create
-- pattern is the portable idempotency guard.
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
drop trigger if exists daily_logs_set_updated_at on public.daily_logs;
create trigger daily_logs_set_updated_at before update on public.daily_logs
  for each row execute function public.set_updated_at();
drop trigger if exists weight_history_set_updated_at on public.weight_history;
create trigger weight_history_set_updated_at before update on public.weight_history
  for each row execute function public.set_updated_at();
drop trigger if exists custom_foods_set_updated_at on public.custom_foods;
create trigger custom_foods_set_updated_at before update on public.custom_foods
  for each row execute function public.set_updated_at();
drop trigger if exists meal_templates_set_updated_at on public.meal_templates;
create trigger meal_templates_set_updated_at before update on public.meal_templates
  for each row execute function public.set_updated_at();
