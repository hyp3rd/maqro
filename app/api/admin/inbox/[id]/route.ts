import {
  getReceivedEmail,
  listReceivedAttachments,
} from "@/lib/email/receiving";
import { requireAdmin } from "@/lib/rbac";
import { NextResponse } from "next/server";

/** Detail view for a single received email. Fans out two Resend
 *  calls in parallel (the email body + the attachments list) so the
 *  admin UI gets everything in one round-trip from the browser. */
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (typeof id !== "string" || id.length === 0) {
    return NextResponse.json({ error: "Bad id." }, { status: 400 });
  }

  const [emailRes, attachmentsRes] = await Promise.all([
    getReceivedEmail(id),
    listReceivedAttachments(id),
  ]);

  if (!emailRes.ok) {
    if (emailRes.error.kind === "not-configured") {
      return NextResponse.json(
        { ok: false, error: "Resend isn't configured." },
        { status: 503 },
      );
    }
    if (emailRes.error.kind === "not-found") {
      return NextResponse.json(
        { ok: false, error: "Email not found." },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { ok: false, error: emailRes.error.message },
      { status: 502 },
    );
  }

  // Attachment listing failure isn't fatal — the body is the
  // primary content. We return an empty list rather than failing
  // the whole detail view.
  const attachments = attachmentsRes.ok ? attachmentsRes.attachments : [];

  return NextResponse.json({ ok: true, email: emailRes.email, attachments });
}
