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
 *    - Every successful change writes an audit log row.
 *    - Invalid roles and malformed user ids return 400 (CHECK
 *      constraint would also reject, but the explicit 400 reads
 *      better).
 *    - The role lives on the user's profiles row, which migration
 *      0074 creates at sign-up. The change is an UPDATE that must
 *      match that row; no row → 404, nothing audited. (A
 *      payload-less upsert can't create the row anyway: payload is
 *      NOT NULL, and Postgres checks that before ON CONFLICT.) */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id: targetUserId } = await ctx.params;
  // Same shape check as the sibling admin user routes: Supabase user ids
  // are UUIDs, and a malformed one would otherwise surface as a 500.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      targetUserId,
    )
  ) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }

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

  // Read the prior role so the audit row captures the diff.
  const { data: existing, error: readError } = await admin
    .from("profiles")
    .select("role")
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }
  const previousRole = (existing?.role as string | undefined) ?? "user";

  const { data: updated, error: updateError } = await admin
    .from("profiles")
    .update({ role: newRole })
    .eq("user_id", targetUserId)
    .select("user_id");
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: "User has no profile." },
      { status: 404 },
    );
  }

  await writeAuditLog({
    adminUserId: guard.userId,
    action: "role.set",
    targetUserId,
    payload: { from: previousRole, to: newRole },
  });

  return NextResponse.json({ ok: true, role: newRole });
}
