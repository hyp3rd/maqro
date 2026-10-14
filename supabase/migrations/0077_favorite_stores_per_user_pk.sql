-- Key favorite_stores per user: primary key (user_id, id) instead of (id).
--
-- 0047's header promises "one row per (user, OSM key)", but its DDL made the
-- OSM key alone (`id`, e.g. "node/123") the primary key. That key is shared by
-- every user who sees the same shop, so once user A favourited a store, user
-- B's push of the same key — supabase-js `.upsert(row)`, which PostgREST turns
-- into `INSERT ... ON CONFLICT (<primary key>) DO UPDATE` — conflicted with
-- A's row. The ON CONFLICT UPDATE path checks the existing row against the
-- owner-only USING policy and raises 42501 instead of skipping it, so B's
-- favourite never reached the server or B's other devices, the sync pill sat
-- in "Needs review" on every sync, and its "Discard local changes" remedy
-- deleted the favourite. Those favourites are still queued as dirty rows in
-- IndexedDB; the first sync after this migration pushes them.
--
-- Fix: make the key (user_id, id), the codebase's pattern for text ids
-- (0058 fast_sessions). Existing rows keep their values: `id` was globally
-- unique, so every (user_id, id) pair already is. favorite_stores_user_idx
-- (user_id) is dropped because the new primary key's leading column serves
-- the same `user_id = …` lookups (pull, RLS).
--
-- Safe for the currently deployed app, which ships before/after this lands:
--   - upsert without `onConflict` targets whatever the primary key is, and
--     every pushed row carries user_id, so it now inserts per user;
--   - its UPDATE / DELETE filter on `id` alone, which RLS already scopes to
--     the caller's own rows — exactly one row per user under the new key;
--   - realtime DELETE payloads carry the primary key columns (default replica
--     identity), so `old.id` is still present — and now `old.user_id` too,
--     which the new client checks before deleting locally (RLS is not
--     applied to realtime DELETE events).
--
-- Idempotent: the key swap only runs while the primary key is still the
-- single `id` column. The table is small, so the brief ACCESS EXCLUSIVE lock
-- the swap takes is not a concern.
--
-- Regression coverage: supabase/tests/favorite_stores_per_user_pk_test.sql.

do $$
begin
  if exists (
    select 1
      from pg_catalog.pg_constraint c
     where c.conrelid = 'public.favorite_stores'::regclass
       and c.contype = 'p'
       and c.conname = 'favorite_stores_pkey'
       and c.conkey = array[(
         select a.attnum
           from pg_catalog.pg_attribute a
          where a.attrelid = 'public.favorite_stores'::regclass
            and a.attname = 'id'
       )]::int2[]
  ) then
    alter table public.favorite_stores drop constraint favorite_stores_pkey;
    alter table public.favorite_stores
      add constraint favorite_stores_pkey primary key (user_id, id);
  end if;
end $$;

drop index if exists public.favorite_stores_user_idx;
