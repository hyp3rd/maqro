import { dismissEmail } from "@/lib/email/dismissed";
import { requireAdmin, writeAuditLog } from "@/lib/rbac";
import { NextResponse } from "next/server";

/** Archive (hide) an inbound message from the admin inbox. Resend can't delete
 *  received emails, so this just records the id; the list filters it out. */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;

  const result = await dismissEmail(id, guard.userId);
  await writeAuditLog({
    adminUserId: guard.userId,
    action: "inbox.dismiss",
    payload: { emailId: id, ok: result.ok, error: result.error ?? null },
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
