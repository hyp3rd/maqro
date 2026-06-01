import { listReceivedEmails } from "@/lib/email/receiving";
import { requireAdmin } from "@/lib/rbac";
import { NextResponse } from "next/server";

/** Admin inbox — read-only listing of every email Resend has
 *  received for the configured inbound domain. Backed by Resend's
 *  receiving API; the route is a thin pass-through that adds the
 *  admin gate + a stable response shape.
 *
 *  Returns:
 *    - 200 { ok: true, emails: [...] } on success
 *    - 200 { ok: true, emails: [], notice: 'not-configured' } when
 *           RESEND_API_KEY isn't set (so the UI renders a hint
 *           instead of an error)
 *    - 502 on Resend API failure */
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const result = await listReceivedEmails();
  if (!result.ok) {
    if (result.error.kind === "not-configured") {
      return NextResponse.json({
        ok: true,
        emails: [],
        notice: "not-configured",
      });
    }
    return NextResponse.json(
      { ok: false, error: result.error.message },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, emails: result.emails });
}
