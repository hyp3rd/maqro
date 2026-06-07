import { requireAdmin } from "@/lib/rbac";
import { ensureCampaignForLatest } from "@/lib/social/campaign";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// The Anthropic draft call needs the Node runtime + headroom.
export const runtime = "nodejs";
export const maxDuration = 60;

/** Admin "Generate now": draft a campaign for the latest changelog entry
 *  immediately, instead of waiting for the hourly cron. Idempotent. */
export async function POST(): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

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

  const result = await ensureCampaignForLatest(admin);
  if (result.status === "error") {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(result);
}
