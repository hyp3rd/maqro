import { requireAdmin } from "@/lib/rbac";
import { publishPost } from "@/lib/social/publish";
import type { PublishablePost, SocialPlatform } from "@/lib/social/types";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// The adapters use node:crypto (X OAuth signing).
export const runtime = "nodejs";

/** Publish a post. If its platform has credentials, call the live API and record
 *  published_id / failure. If not, fall back to a manual mark-posted (the admin
 *  posted by hand). */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;

  const config = getSupabaseSecretConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Supabase service-role key not configured." },
      { status: 503 },
    );
  }
  const admin = createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: row, error: loadErr } = await admin
    .from("social_posts")
    .select("platform, body, image_url")
    .eq("id", id)
    .single();
  if (loadErr || !row) {
    return NextResponse.json({ error: "Post not found." }, { status: 404 });
  }
  const post: PublishablePost = {
    platform: row.platform as SocialPlatform,
    body: row.body as string,
    imageUrl: (row.image_url as string | null) ?? null,
  };

  const result = await publishPost(post);

  if (result.ok) {
    await admin
      .from("social_posts")
      .update({
        status: "published",
        published_id: result.id || null,
        published_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", id);
    return NextResponse.json({
      status: "published",
      publishedId: result.id,
      url: result.url,
    });
  }

  if (!result.configured) {
    // No credentials for this platform — the admin posted by hand; just mark it.
    await admin
      .from("social_posts")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", id);
    return NextResponse.json({ status: "published", manual: true });
  }

  // Configured but the platform API rejected it — record the failure.
  await admin
    .from("social_posts")
    .update({ status: "failed", error: result.error })
    .eq("id", id);
  return NextResponse.json(
    { status: "failed", error: result.error },
    { status: 502 },
  );
}
