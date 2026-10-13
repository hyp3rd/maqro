-- Every PL/pgSQL function in `public` must type-check — trigger functions
-- against each table they are attached to.
--
-- PL/pgSQL resolves NEW/OLD fields and most column references only when a
-- statement executes, so `create function` accepts a body that fails at run
-- time: 0068 shipped `new.welcome_sent_at := null` on public.profiles, which
-- has no such column, and every new user's first sync failed with 42703
-- until 0073. `supabase db lint` does not catch this class — it checks
-- trigger functions without a relation, so NEW/OLD fields are never resolved.
-- plpgsql_check does once it is given the table, which is what this test
-- does for every trigger. Run with `supabase test db`.
begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists plpgsql_check with schema extensions;

select plan(2);

select is_empty(
  $$
    select t.tgrelid::regclass::text as table_name, t.tgname::text as trigger_name,
           c.lineno, c.sqlstate, c.message
      from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid
      join pg_language l on l.oid = p.prolang and l.lanname = 'plpgsql'
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
     cross join lateral extensions.plpgsql_check_function_tb(p.oid, t.tgrelid) c
     where not t.tgisinternal
       and c.level = 'error'
  $$,
  'every public PL/pgSQL trigger function type-checks against each table it is attached to'
);

select is_empty(
  $$
    select p.oid::regprocedure::text as function_name, c.lineno, c.sqlstate, c.message
      from pg_proc p
      join pg_language l on l.oid = p.prolang and l.lanname = 'plpgsql'
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
     cross join lateral extensions.plpgsql_check_function_tb(p.oid) c
     where p.prorettype <> 'trigger'::regtype
       and c.level = 'error'
  $$,
  'every public PL/pgSQL function type-checks'
);

select * from finish();
rollback;
