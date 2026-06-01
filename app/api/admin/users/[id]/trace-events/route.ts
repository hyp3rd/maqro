import { listTraceEvents } from "@/lib/admin-trace";
import { requireAdmin } from "@/lib/rbac";
import { NextResponse } from "next/server";

/** GET /api/admin/users/[id]/trace-events — the operator's window
 *  into what's been captured for a flagged user. Powers the
 *  "Trace events" panel on /admin/users/[id].
 *
 *  Returns the latest N rows from `trace_events` (default 50,
 *  cap 200). Newest first; no filtering UI yet — the panel
 *  itself can grow that as use cases emerge. */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }

  const url = new URL(req.url);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit") ?? String(DEFAULT_LIMIT))),
  );

  const rows = await listTraceEvents(id, limit);
  if (rows === null) {
    return NextResponse.json(
      { error: "Supabase service-role key not configured." },
      { status: 503 },
    );
  }
  return NextResponse.json({ rows });
}
