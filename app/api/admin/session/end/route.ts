import { endAdminSession } from "@/lib/admin-sessions";
import { requireAdmin } from "@/lib/rbac";
import { NextResponse } from "next/server";

/** POST /api/admin/session/end — explicit "Exit admin" trigger.
 *
 *  Closes the operator's most-recent open admin session with
 *  `reason='manual'` and writes the `admin.session.end` audit
 *  row. Idempotent — a re-fire (double-click, replay) does
 *  nothing if no session is open.
 *
 *  Keeps the Supabase auth session intact. The operator is still
 *  signed in to the app after exiting admin; they just stop
 *  showing up as "in the admin panel" on session reports.
 *
 *  Returns 200 with `{ ok: true }` on success (or no-op).
 *  Requires the caller to be an admin — non-admins can't fabricate
 *  end-of-session events for someone else. */
export async function POST(): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  await endAdminSession(guard.userId);
  return NextResponse.json({ ok: true });
}
