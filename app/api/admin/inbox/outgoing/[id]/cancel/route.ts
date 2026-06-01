import { cancelOutgoingEmail } from "@/lib/email/sending";
import { reportServerError } from "@/lib/error-reporter";
import { requireAdmin, writeAuditLog } from "@/lib/rbac";
import { NextResponse } from "next/server";

/** POST /api/admin/inbox/outgoing/[id]/cancel — cancel a scheduled
 *  outbound. Only meaningful while Resend has the message in the
 *  `scheduled` state; for already-queued/sent messages Resend
 *  rejects the call and we surface the error to the operator.
 *
 *  No DB mutation here — the `admin_sent_emails` row stays
 *  intact; the canonical cancellation signal is the live status
 *  returned by `GET /emails/{id}`. Audit log records the attempt
 *  either way so we can correlate "operator clicked cancel" with
 *  "delivery never landed" when triaging later. */

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (typeof id !== "string" || id.length === 0) {
    return NextResponse.json({ error: "Bad id." }, { status: 400 });
  }

  const result = await cancelOutgoingEmail(id);

  // Always audit — the attempt is the operator-visible action,
  // regardless of whether Resend honoured it.
  await writeAuditLog({
    adminUserId: guard.userId,
    action: "inbox.cancel",
    payload: {
      resendId: id,
      ok: result.ok,
      error: result.ok ? null : result.error,
    },
  });

  if (!result.ok) {
    if (result.error.kind === "not-configured") {
      return NextResponse.json(
        { error: "Resend isn't configured." },
        { status: 503 },
      );
    }
    if (result.error.kind === "not-found") {
      return NextResponse.json(
        { error: "Email not found at Resend." },
        { status: 404 },
      );
    }
    await reportServerError(new Error(result.error.message), {
      route: "/api/admin/inbox/outgoing/[id]/cancel",
      context: { resendId: id },
    });
    return NextResponse.json({ error: result.error.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
