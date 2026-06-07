import { CHANGELOG } from "@/lib/changelog";
import { generateCampaignDrafts } from "@/lib/social/generate";
import type { SupabaseClient } from "@supabase/supabase-js";

export type EnsureResult =
  | { status: "created"; campaignId: string; posts: number }
  | { status: "exists"; campaignId: string }
  | { status: "no-entry" }
  | { status: "error"; error: string };

/** The public `/api/release/og` card for a changelog entry — the image the
 *  Instagram post carries (and the dashboard previews). Absolute when
 *  NEXT_PUBLIC_APP_URL is set (the IG Graph API fetches by URL); relative
 *  otherwise, which still previews in-app. */
export function releaseImageUrl(changelogId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `${base}/api/release/og?id=${encodeURIComponent(changelogId)}`;
}

/** Generate a draft campaign for the latest changelog entry if one doesn't
 *  already exist. Idempotent on `changelog_id`. Shared by the cron (auto, on a
 *  new release) and the admin "Generate now" button. `admin` is a service-role
 *  Supabase client (these tables are RLS-denied to everyone else). */
export async function ensureCampaignForLatest(
  admin: SupabaseClient,
): Promise<EnsureResult> {
  const entry = CHANGELOG[0];
  if (!entry) return { status: "no-entry" };

  const { data: existing } = await admin
    .from("social_campaigns")
    .select("id")
    .eq("changelog_id", entry.id)
    .maybeSingle();
  if (existing) return { status: "exists", campaignId: existing.id as string };

  const drafts = await generateCampaignDrafts(entry);
  if (!drafts.ok) return { status: "error", error: drafts.error };

  const { data: campaign, error: campErr } = await admin
    .from("social_campaigns")
    .insert({
      changelog_id: entry.id,
      title: entry.title,
      version: entry.version ?? null,
      status: "draft",
    })
    .select("id")
    .single();
  if (campErr || !campaign) {
    return {
      status: "error",
      error: campErr?.message ?? "campaign insert failed",
    };
  }

  const rows = drafts.posts.map((p) => ({
    campaign_id: campaign.id,
    platform: p.platform,
    body: p.body,
    image_url: p.platform === "instagram" ? releaseImageUrl(entry.id) : null,
    status: "draft",
  }));
  const { error: postsErr } = await admin.from("social_posts").insert(rows);
  if (postsErr) return { status: "error", error: postsErr.message };

  return {
    status: "created",
    campaignId: campaign.id as string,
    posts: rows.length,
  };
}
