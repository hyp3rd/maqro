-- Per-row custom sort order for the three list tables that surface in
-- a user-managed view (My Foods, Recipes, Templates). The active sort
-- *mode* (name / date / type / custom) lives in per-device
-- localStorage; only the manually-arranged order itself syncs.
--
-- Why double precision instead of an integer: inserting a row between
-- two existing ones is the average of the neighbors' values — no
-- renumber cascade needed, no compaction pass. Nullable so legacy
-- rows render as "no custom order" until the user drags one.

alter table public.custom_foods   add column if not exists sort_order double precision;
alter table public.recipes        add column if not exists sort_order double precision;
alter table public.meal_templates add column if not exists sort_order double precision;

create index if not exists custom_foods_sort_idx   on public.custom_foods   (user_id, sort_order);
create index if not exists recipes_sort_idx        on public.recipes        (user_id, sort_order);
create index if not exists meal_templates_sort_idx on public.meal_templates (user_id, sort_order);
