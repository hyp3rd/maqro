import { assertCronSecret } from "@/lib/auth/cron-secret";
import { ensureCampaignForLatest } from "@/lib/social/campaign";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// The Anthropic draft call needs the Node runtime + a little headroom.
export const runtime = "nodejs";
export const maxDuration = 60;

/** Hourly: if the latest changelog entry doesn't yet have a social campaign,
 *  draft one (X / LinkedIn / Instagram) for human review at /admin/social. A
 *  no-op on every run where the top entry is already processed. */
export async function GET(req: Request): Promise<NextResponse> {
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

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
