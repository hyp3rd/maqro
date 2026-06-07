-- Social campaigns + posts: AI-drafted, human-approved release marketing for X /
-- LinkedIn / Instagram, generated from a new changelog entry. Admin/ops-only —
-- RLS is enabled with NO policy, so only the service-role (the cron + the admin
-- routes) can read or write; no end user ever touches these. The set_updated_at
-- trigger matches the rest of the schema.

create table if not exists public.social_campaigns (
  id uuid primary key default gen_random_uuid (),
  -- The lib/changelog.ts entry id this campaign was generated from. Unique so a
  -- re-run of the detector can never double-create.
  changelog_id text not null unique,
  title text not null,
  version text,
  status text not null default 'draft', -- draft | approved | published | skipped
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid (),
  campaign_id uuid not null references public.social_campaigns (id) on delete cascade,
  platform text not null, -- x | linkedin | instagram
  body text not null,
  image_url text, -- the /api/release/og card, for Instagram
  status text not null default 'draft', -- draft | approved | published | failed
  published_id text, -- the platform's returned post id / permalink
  published_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists social_posts_campaign_idx on public.social_posts (campaign_id);

-- RLS on, no policy: deny-by-default for every anon/authenticated role. The
-- service-role key (cron + admin) bypasses RLS, which is the only access path.
alter table public.social_campaigns enable row level security;

alter table public.social_posts enable row level security;

drop trigger if exists social_campaigns_set_updated_at on public.social_campaigns;

create trigger social_campaigns_set_updated_at before update on public.social_campaigns for each row
execute function public.set_updated_at ();

drop trigger if exists social_posts_set_updated_at on public.social_posts;

create trigger social_posts_set_updated_at before update on public.social_posts for each row
execute function public.set_updated_at ();
