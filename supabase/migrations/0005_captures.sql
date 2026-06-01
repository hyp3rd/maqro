-- Captures — short-lived pairing sessions for the camera flow. The
-- laptop calls /api/capture/init which inserts a row (auth required,
-- RLS scopes it to the user). The phone uploads a photo via a signed
-- Storage URL or POSTs a barcode directly (both unauth, gated only by
-- knowing the session UUID). The laptop polls /api/capture/[id] for
-- results.
--
-- 5-minute expiry caps the attack window: a leaked session id only
-- accepts uploads for that long.

create table if not exists public.captures (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 'photo' or 'barcode' once the phone uploads. NULL while waiting.
  kind text,
  -- For barcode flow: the decoded code, written by the unauth POST
  -- route via service-role.
  barcode text,
  -- For photo flow: Storage path under the captures bucket. Written by
  -- the phone's photo-done POST so the laptop doesn't have to poll
  -- Storage directly.
  photo_path text,
  created_at timestamptz not null default now (),
  expires_at timestamptz not null default now () + interval '5 minutes'
);

create index if not exists captures_user_idx on public.captures (user_id);
create index if not exists captures_expires_idx on public.captures (expires_at);

alter table public.captures enable row level security;

-- Only the owner reads / updates / deletes their own session rows.
-- The unauth POST routes (/barcode, /photo-done) bypass this via the
-- service-role client, validating freshness in application code.
drop policy if exists "captures_owner_all" on public.captures;
create policy "captures_owner_all"
  on public.captures
  for all
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

-- ─── Storage bucket for the photo blobs ────────────────────────────────────
-- Path convention: `<user_id>/<capture_id>.jpg`. Same per-user folder
-- RLS pattern as the exports bucket (0004_exports_storage.sql).

insert into storage.buckets (id, name, public)
values ('captures', 'captures', false)
on conflict (id) do nothing;

drop policy if exists "captures_owner_select" on storage.objects;
create policy "captures_owner_select"
  on storage.objects for select
  using (
    bucket_id = 'captures'
    and (storage.foldername (name))[1] = auth.uid ()::text
  );

drop policy if exists "captures_owner_insert" on storage.objects;
create policy "captures_owner_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'captures'
    and (storage.foldername (name))[1] = auth.uid ()::text
  );

drop policy if exists "captures_owner_update" on storage.objects;
create policy "captures_owner_update"
  on storage.objects for update
  using (
    bucket_id = 'captures'
    and (storage.foldername (name))[1] = auth.uid ()::text
  )
  with check (
    bucket_id = 'captures'
    and (storage.foldername (name))[1] = auth.uid ()::text
  );

drop policy if exists "captures_owner_delete" on storage.objects;
create policy "captures_owner_delete"
  on storage.objects for delete
  using (
    bucket_id = 'captures'
    and (storage.foldername (name))[1] = auth.uid ()::text
  );
