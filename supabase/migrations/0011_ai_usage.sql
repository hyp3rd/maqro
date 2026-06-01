-- AI-usage metering for the free-tier cap. Each AI route
-- (meal-plan, identify-meal, recipes/generate) calls
-- `checkAndIncrementAiUsage` before doing real work; if the user
-- has hit the monthly cap and isn't premium, the route returns 402
-- without burning Anthropic budget.
--
-- Per-month aggregate (rather than per-call rows) keeps the table
-- tiny — one row per active user per month. If we ever need
-- per-call audit data we can add it in a sibling table without
-- disturbing this one.

create table if not exists public.ai_usage_monthly (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- First day of the metering month in UTC. The route computes this
  -- as `YYYY-MM-01` and the unique constraint keeps usage anchored
  -- to a stable bucket regardless of local timezone.
  period_start date not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, period_start)
);

create index if not exists ai_usage_monthly_user_idx
  on public.ai_usage_monthly (user_id);

alter table public.ai_usage_monthly enable row level security;

-- Owners read/write their own usage row. The route checks +
-- increments via the server-side Supabase client, which is bound to
-- the caller's session, so the policy is straightforward.
drop policy if exists "ai_usage_owner_all" on public.ai_usage_monthly;
create policy "ai_usage_owner_all"
  on public.ai_usage_monthly
  for all
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

drop trigger if exists ai_usage_monthly_set_updated_at on public.ai_usage_monthly;
create trigger ai_usage_monthly_set_updated_at
  before update on public.ai_usage_monthly
  for each row execute function public.set_updated_at ();

-- Premium flag on profiles. `false` = free tier; `true` = paid /
-- otherwise-entitled. Filled by the Stripe webhook (or manually
-- toggled for early supporters / staff) in a follow-up; for now the
-- column exists so the AI-usage check can branch on it cleanly. The
-- existing recipes_owner_all-style RLS on profiles already prevents
-- a user from reading/writing other users' premium flag.
alter table public.profiles
  add column if not exists is_premium boolean not null default false;
