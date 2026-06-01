import { parseBody } from "@/lib/api/parse-body";
import { requireAdmin, writeAuditLog } from "@/lib/rbac";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const BodySchema = z.object({ role: z.enum(["user", "admin"]) });

/** PATCH a user's role. Body: `{ role: "user" | "admin" }`.
 *
 *  Guard rails:
 *    - Only admins can call this (requireAdmin).
 *    - Admins can't demote themselves - that's a soft lock to
 *      prevent the single-admin-bricks-the-app foot-gun. To
 *      remove the last admin, an operator must edit the DB
 *      directly.
 *    - Every call writes an audit log row.
 *    - Invalid roles return 400 (CHECK constraint would also
 *      reject, but the explicit 400 reads better). */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id: targetUserId } = await ctx.params;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const newRole = parsed.data.role;

  if (targetUserId === guard.userId && newRole !== "admin") {
    return NextResponse.json(
      { error: "Admins can't demote themselves." },
      { status: 400 },
    );
  }

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

  // Read the prior role so the audit row captures the diff. We
  // don't fail if there's no profile row - the upsert below
  // creates it.
  const { data: existing } = await admin
    .from("profiles")
    .select("role")
    .eq("user_id", targetUserId)
    .maybeSingle();
  const previousRole = (existing?.role as string | undefined) ?? "user";

  const { error: updateError } = await admin
    .from("profiles")
    .upsert(
      { user_id: targetUserId, role: newRole },
      { onConflict: "user_id" },
    );
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await writeAuditLog({
    adminUserId: guard.userId,
    action: "role.set",
    targetUserId,
    payload: { from: previousRole, to: newRole },
  });

  return NextResponse.json({ ok: true, role: newRole });
}
