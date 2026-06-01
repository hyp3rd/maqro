import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** Remove a Web Push subscription. Called when the user toggles
 *  push off in Settings or revokes browser permission. The client
 *  unsubscribes from PushManager first (so the provider stops
 *  routing); this endpoint cleans up the row.
 *
 *  Body: { endpoint? } — when provided, deletes that single row;
 *  when omitted, deletes ALL rows for the caller (used by the
 *  "Disable on every device" path). */

type Body = { endpoint?: string };

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase isn't configured." },
      { status: 503 },
    );
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

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // Empty body is fine — fall through with no endpoint (= delete all).
  }
  const endpoint = body.endpoint?.trim();

  const query = supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id);
  const { error: delErr } = endpoint
    ? await query.eq("endpoint", endpoint)
    : await query;
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
