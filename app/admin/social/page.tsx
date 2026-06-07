import { configuredPlatforms } from "@/lib/social/env";
import {
  type CampaignStatus,
  type PostStatus,
  type SocialCampaign,
  type SocialPlatform,
  type SocialPost,
} from "@/lib/social/types";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { createClient } from "@supabase/supabase-js";
import { SocialDashboard } from "./SocialDashboard";

// Admin-only, gated by app/admin/layout.tsx (role === 'admin'). The tables are
// RLS-denied to everyone, so we read them with the service-role client.
export const dynamic = "force-dynamic";

type CampaignRow = {
  id: string;
  changelog_id: string;
  title: string;
  version: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type PostRow = {
  id: string;
  campaign_id: string;
  platform: string;
  body: string;
  image_url: string | null;
  status: string;
  published_id: string | null;
  published_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

async function load(): Promise<{
  campaigns: SocialCampaign[];
  posts: SocialPost[];
} | null> {
  const config = getSupabaseSecretConfig();
  if (!config) return null;
  const admin = createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: campaignRows } = await admin
    .from("social_campaigns")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);
  const campaigns = ((campaignRows ?? []) as CampaignRow[]).map(toCampaign);

  const ids = campaigns.map((c) => c.id);
  const { data: postRows } = ids.length
    ? await admin.from("social_posts").select("*").in("campaign_id", ids)
    : { data: [] };
  const posts = ((postRows ?? []) as PostRow[]).map(toPost);

  return { campaigns, posts };
}

export default async function AdminSocialPage() {
  const data = await load();
  if (!data) {
    return (
      <p className="text-sm text-muted-foreground">
        Supabase service-role key isn&apos;t configured on this deployment.
      </p>
    );
  }
  return (
    <SocialDashboard
      campaigns={data.campaigns}
      posts={data.posts}
      configured={configuredPlatforms()}
    />
  );
}

function toCampaign(r: CampaignRow): SocialCampaign {
  return {
    id: r.id,
    changelogId: r.changelog_id,
    title: r.title,
    version: r.version,
    status: r.status as CampaignStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toPost(r: PostRow): SocialPost {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    platform: r.platform as SocialPlatform,
    body: r.body,
    imageUrl: r.image_url,
    status: r.status as PostStatus,
    publishedId: r.published_id,
    publishedAt: r.published_at,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
