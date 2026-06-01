-- Exports bucket for user-initiated JSON backups. Object naming is
-- `<user_id>/<exportedAt>.json`, with `(storage.foldername(name))[1]` —
-- the leading path segment — used as the owner key for RLS. That mirrors
-- the convention Supabase docs recommend for per-user storage.

insert into storage.buckets (id, name, public)
values ('exports', 'exports', false)
on conflict (id) do nothing;

-- The owner can read, write, and delete their own objects. No public
-- access; downloads happen via signed URLs minted server-side or via
-- supabase.storage.download() while a session is active.

-- `create policy if not exists` requires Postgres 16+. Use the
-- drop-then-create pattern so the migration is idempotent on every
-- supported Postgres version.
drop policy if exists "exports_owner_select" on storage.objects;
create policy "exports_owner_select"
  on storage.objects for select
  using (
    bucket_id = 'exports'
    and (storage.foldername (name))[1] = auth.uid ()::text
  );

drop policy if exists "exports_owner_insert" on storage.objects;
create policy "exports_owner_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'exports'
    and (storage.foldername (name))[1] = auth.uid ()::text
  );

drop policy if exists "exports_owner_update" on storage.objects;
create policy "exports_owner_update"
  on storage.objects for update
  using (
    bucket_id = 'exports'
    and (storage.foldername (name))[1] = auth.uid ()::text
  )
  with check (
    bucket_id = 'exports'
    and (storage.foldername (name))[1] = auth.uid ()::text
  );

drop policy if exists "exports_owner_delete" on storage.objects;
create policy "exports_owner_delete"
  on storage.objects for delete
  using (
    bucket_id = 'exports'
    and (storage.foldername (name))[1] = auth.uid ()::text
  );
