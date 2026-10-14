-- Regression tests for favorite_stores' per-user primary key (migration 0077).
--
-- Before 0077 the OSM key alone was the primary key, so once one user starred
-- a store ("node/123") every other user's upsert of the same key hit that
-- user's row and failed RLS with 42501, forever.
--
-- End-user requests are simulated the way PostgREST runs them: `set local
-- role authenticated` plus `request.jwt.claims`, which auth.uid() reads. The
-- upserts mirror what supabase-js `.upsert(row)` sends without `onConflict`:
-- PostgREST targets the table's primary key columns. Run with
-- `supabase test db`; see CONTRIBUTING.md §10.
begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email, aud, role) values
  ('b0000000-0000-4000-8000-000000000001', 'alice@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-000000000002', 'bob@example.test', 'authenticated', 'authenticated');

select col_is_pk(
  'public', 'favorite_stores', array['user_id', 'id'],
  'favorite_stores is keyed per user: primary key (user_id, id)'
);

select hasnt_index(
  'public', 'favorite_stores', 'favorite_stores_user_idx',
  'the user_id-only index is gone (the primary key''s leading column covers it)'
);

-- ── alice stars node/123 ────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub": "b0000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$
    insert into public.favorite_stores (id, user_id, name, kind, lat, lon)
    values ('node/123', 'b0000000-0000-4000-8000-000000000001', 'Corner Market', 'supermarket', 45.1, 9.2)
    on conflict (user_id, id) do update
      set name = excluded.name, kind = excluded.kind, lat = excluded.lat, lon = excluded.lon
  $$,
  'alice can favourite node/123'
);

-- ── bob stars the SAME store ────────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '{"sub": "b0000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$
    insert into public.favorite_stores (id, user_id, name, kind, lat, lon)
    values ('node/123', 'b0000000-0000-4000-8000-000000000002', 'Corner Market', 'supermarket', 45.1, 9.2)
    on conflict (user_id, id) do update
      set name = excluded.name, kind = excluded.kind, lat = excluded.lat, lon = excluded.lon
  $$,
  'bob can favourite the same store alice already favourited'
);

select results_eq(
  $$ select id, user_id from public.favorite_stores $$,
  $$ values ('node/123'::text, 'b0000000-0000-4000-8000-000000000002'::uuid) $$,
  'bob sees only his own favourite'
);

select lives_ok(
  $$
    insert into public.favorite_stores (id, user_id, name, kind, lat, lon)
    values ('node/123', 'b0000000-0000-4000-8000-000000000002', 'Corner Market (renamed)', 'supermarket', 45.1, 9.2)
    on conflict (user_id, id) do update
      set name = excluded.name, kind = excluded.kind, lat = excluded.lat, lon = excluded.lon
  $$,
  'a re-push of bob''s favourite takes the upsert''s update path'
);

select throws_ok(
  $$
    insert into public.favorite_stores (id, user_id, name, kind, lat, lon)
    values ('node/999', 'b0000000-0000-4000-8000-000000000001', 'Squat', 'supermarket', 0, 0)
  $$,
  '42501',
  null,
  'bob cannot create a favourite owned by alice'
);

-- The sync engine's tombstone drain: `DELETE ... WHERE id = <rowKey>`, scoped
-- to the caller by RLS.
delete from public.favorite_stores where id = 'node/123';

reset role;

select results_eq(
  $$ select user_id from public.favorite_stores where id = 'node/123' $$,
  $$ values ('b0000000-0000-4000-8000-000000000001'::uuid) $$,
  'bob''s unfavourite deletes only his row; alice''s survives'
);

select results_eq(
  $$
    select name from public.favorite_stores
     where user_id = 'b0000000-0000-4000-8000-000000000001' and id = 'node/123'
  $$,
  $$ values ('Corner Market'::text) $$,
  'bob''s writes never touched alice''s row'
);

select throws_ok(
  $$
    insert into public.favorite_stores (id, user_id, name, kind, lat, lon)
    values ('node/123', 'b0000000-0000-4000-8000-000000000001', 'Dup', 'supermarket', 0, 0)
  $$,
  '23505',
  null,
  'a user still cannot hold the same store twice'
);

select col_not_null(
  'public', 'favorite_stores', 'user_id',
  'user_id stays not null'
);

select * from finish();
rollback;
