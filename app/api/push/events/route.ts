import { parseBody } from "@/lib/api/parse-body";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const BodySchema = z.object({
  event: z.enum(["click", "close"]),
  tag: z.string().optional(),
});

/** Service-worker → server callback for push notification engagement.
 *
 *  Called by `public/sw.js` from inside `notificationclick` (and
 *  `notificationclose` where the browser supports it). The SW
 *  POSTs `{ tag, event }`; we authenticate via the cookie session
 *  the SW carries on same-origin fetch and insert one row.
 *
 *  RLS-enforced. Anonymous calls (no session) are silently
 *  accepted as 401 — the SW does best-effort delivery and we don't
 *  want a logging miss to throw inside the notificationclick
 *  handler (which would leave the user with the notification still
 *  visible).
 *
 *  Body validation is strict: only `'click'` / `'close'` events are
 *  recorded; anything else returns 400 so a typo in the SW is loud.
 *
 *  No-cache: this endpoint is event-stream, not data. We respond
 *  202 (Accepted) because the row write is fire-and-forget from the
 *  SW's perspective — it doesn't await this response before
 *  closing the notification or navigating. */

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await getSupabaseServer();
  if (!supabase) {
    // Supabase not configured (preview env). Accept silently —
    // service worker shouldn't care; engagement stats just stay
    // empty.
    return NextResponse.json({ ok: true, recorded: false }, { status: 202 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const gate = await assertAal2(
    supabase,
    await trustedDeviceOption(supabase, user.id),
  );
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { event } = parsed.data;
  const tag = parsed.data.tag?.trim() || null;

  const { error: insErr } = await supabase
    .from("push_event_log")
    .insert({ user_id: user.id, event, tag });
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, recorded: true }, { status: 202 });
}
