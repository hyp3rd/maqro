import { requireAdmin } from "@/lib/rbac";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Mark a post as published. Phase 1 is manual: the admin posts by hand, then
 *  flips this. Phase 2 swaps the per-platform adapter in here (call the X /
 *  LinkedIn / Instagram API, set `published_id` from the response, `failed` +
 *  `error` on a non-2xx) with no change to the dashboard. */
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
  const { error } = await admin
    .from("social_posts")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
