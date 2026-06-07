import { parseBody } from "@/lib/api/parse-body";
import { requireAdmin } from "@/lib/rbac";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const BodySchema = z.object({ body: z.string().min(1).max(5000) });

/** Save an edited draft body. The dashboard re-lints on the client, so we store
 *  the reviewer's text verbatim. */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;

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
    .update({ body: parsed.data.body })
    .eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
