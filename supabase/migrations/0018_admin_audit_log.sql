-- Admin audit log. Every state-changing action performed by an
-- admin via the dashboard writes one row here. The table is
-- append-only by convention — there's no UPDATE / DELETE policy
-- and we don't expose either operation via the API.
--
-- Rows live as long as the database. If retention becomes a
-- concern later, add a scheduled DELETE for `created_at <
-- now() - interval '2 years'` and document the policy.

create table if not exists public.admin_audit_log (
  id uuid not null default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),
  -- The admin who performed the action. Foreign-keyed to
  -- auth.users so a deleted account cascades the row out — if
  -- a former admin's account is removed, their actions are no
  -- longer attributable, which is the right privacy posture.
  admin_user_id uuid not null references auth.users (id) on delete cascade,
  -- The user the action was performed on. `null` for actions
  -- that don't target a specific user (settings changes, etc.).
  -- On delete cascade: when a user is deleted, audit rows about
  -- them go too — privacy over forensics.
  target_user_id uuid references auth.users (id) on delete cascade,
  -- A short, stable identifier for the action — `role.set`,
  -- `ai_cap.override`, `account.force_delete`. Lowercase dotted
  -- segments. Add new types as needed; we don't enum-constrain
  -- the column so a feature flag doesn't need a migration.
  action text not null,
  -- Optional structured detail. The before/after state for an
  -- update, the override amount, etc. Scrubbed of secrets by
  -- the caller — we don't apply automatic sanitization here
  -- because what counts as "secret" depends on the action.
  payload jsonb
);

-- Date-descending tail query support — the canonical "show me
-- the last 100 admin actions" view.
create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);

-- Per-target index for "what's been done to this user" lookups
-- on the user-detail page in the admin dashboard.
create index if not exists admin_audit_log_target_idx
  on public.admin_audit_log (target_user_id, created_at desc)
  where target_user_id is not null;

alter table public.admin_audit_log enable row level security;

-- Admins can read. Reads happen via the service-role client in
-- API routes (which bypasses RLS), so this policy is defense in
-- depth — protects against accidental client-side SELECT
-- attempts via the public Supabase URL.
drop policy if exists "admin_audit_log_admin_read"
  on public.admin_audit_log;
create policy "admin_audit_log_admin_read"
  on public.admin_audit_log
  for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid()
        and profiles.role = 'admin'
    )
  );

-- No INSERT / UPDATE / DELETE policies — writes go through
-- service-role only.
