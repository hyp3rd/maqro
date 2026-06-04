-- Server-side store for the user's completed intermittent fasts. Mirrors the
-- local IDB store added in db.ts at v18. Unlike body_measurements / blood_pressure
-- this is **id-keyed**, not date-keyed: a fast can span midnight and a user can
-- run more than one in a day, so (user, day) is the wrong grain. The id is a
-- client-minted UUID shared with the row, same strategy as recipes / pantry.
--
-- `started_at` / `ended_at` are instants (the client stores epoch-ms, sent as
-- ISO). `protocol` + `target_hours` pin the fast-hours target that was in
-- effect, so history stays accurate even if the user later switches protocol.
-- The per-phase breakdown is derived on read in the client, never stored.

create table if not exists public.fast_sessions (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  protocol text not null check (protocol in ('16:8', '18:6', '20:4', 'custom')),
  target_hours double precision not null check (
    target_hours >= 1 and target_hours <= 24
  ),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  check (ended_at >= started_at)
);

create index if not exists fast_sessions_user_idx
  on public.fast_sessions (user_id);

-- RLS — same owner-only pattern as every other synced table.
alter table public.fast_sessions enable row level security;

drop policy if exists "fast_sessions_owner_all" on public.fast_sessions;
create policy "fast_sessions_owner_all"
  on public.fast_sessions
  for all
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

-- updated_at trigger so the sync engine's last-write-wins comparison sees a
-- real timestamp on every server-side write.
drop trigger if exists fast_sessions_set_updated_at on public.fast_sessions;
create trigger fast_sessions_set_updated_at
  before update on public.fast_sessions
  for each row execute function public.set_updated_at ();
