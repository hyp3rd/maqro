import { parseBody } from "@/lib/api/parse-body";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const BodySchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  userAgent: z.string().max(500).optional(),
});

/** Persist a Web Push subscription so the daily-reminder cron can
 *  send notifications to this browser.
 *
 *  Body: { endpoint, keys: { p256dh, auth }, userAgent? } — exactly
 *  the shape returned by `PushManager.subscribe().toJSON()` plus an
 *  optional userAgent for the future "this is your iPhone Safari
 *  push subscription" label.
 *
 *  Upserts on (user_id, endpoint) so re-subscribing on the same
 *  browser (re-grant after permission revoke) bumps `last_seen_at`
 *  rather than duplicating the row. */

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

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const endpoint = body.endpoint.trim();
  const p256dh = body.keys.p256dh.trim();
  const auth = body.keys.auth.trim();

  // Per-user endpoint cap. A real human signs in from ~5 browsers/
  // devices at most; 50 is wide headroom for the legitimate case
  // and a tight bound against a scripted abuse path that registers
  // a fresh endpoint per request (each one would receive every
  // pantry-low / daily-reminder send, exploding our push-service
  // quota and writes against `push_subscriptions`). Re-subscribing
  // on a browser we've already seen — same `endpoint` URL — is
  // always allowed: the upsert below just bumps `last_seen_at`.
  const MAX_ENDPOINTS_PER_USER = 50;
  const [
    { count: existingCount, error: countErr },
    { data: existingForThisEndpoint, error: existingErr },
  ] = await Promise.all([
    supabase
      .from("push_subscriptions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id),
    supabase
      .from("push_subscriptions")
      .select("endpoint")
      .eq("user_id", user.id)
      .eq("endpoint", endpoint)
      .maybeSingle(),
  ]);
  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }
  if (existingErr) {
    return NextResponse.json({ error: existingErr.message }, { status: 500 });
  }
  if (
    !existingForThisEndpoint &&
    (existingCount ?? 0) >= MAX_ENDPOINTS_PER_USER
  ) {
    return NextResponse.json(
      {
        error: "Too many push subscriptions registered for this account.",
        max: MAX_ENDPOINTS_PER_USER,
      },
      { status: 429 },
    );
  }

  const nowIso = new Date().toISOString();
  const { error: upsertErr } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh,
        auth,
        user_agent: body.userAgent ?? null,
        last_seen_at: nowIso,
      },
      { onConflict: "user_id,endpoint" },
    );
  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
