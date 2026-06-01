import { parseBody } from "@/lib/api/parse-body";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

/** Server-side device registration.
 *
 *  Called by the client on sign-in (post-sync, see SyncManager) with
 *  the access-token-derived `session_id`, a stable per-browser
 *  `device_id` (introduced in migration 0028), a user-agent string
 *  for labelling, and an optional pre-computed display label.
 *
 *  Lookup priority for upsert:
 *
 *    1. `(user_id, device_id)` — preferred. The `device_id` is a
 *       UUID persisted in localStorage on the client, stable across
 *       sign-in cycles on the same browser. Hitting an existing row
 *       on this key is what stops the "duplicate device per
 *       sign-in" growth of the list.
 *
 *    2. `(user_id, session_id)` — fallback. Used when the client
 *       didn't send a `device_id` (legacy client, restricted
 *       webview without localStorage). Also used as a transitional
 *       catch for legacy rows that already exist with a NULL
 *       `device_id` — the next registration backfills the column.
 *
 *  Steps:
 *    1. Authenticates via the cookie-bound session.
 *    2. Reads the request's IP + geo from headers (Vercel edge sets
 *       these automatically; on localhost they're absent and the
 *       columns stay null).
 *    3. Upserts the row using the priority above, preserving any
 *       user-edited `device_label` from previous syncs. */

const BodySchema = z.object({
  sessionId: z.string().min(1),
  deviceId: z.string().optional(),
  userAgent: z.string().max(500).optional(),
  deviceLabel: z.string().max(120).optional(),
});

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
  const sessionId = body.sessionId.trim();
  // Validate device_id shape if present — only accept UUIDs to
  // prevent a misbehaving client from polluting the column with
  // arbitrary strings that would defeat the unique index.
  const rawDeviceId = body.deviceId?.trim() ?? null;
  const deviceId =
    rawDeviceId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      rawDeviceId,
    )
      ? rawDeviceId
      : null;

  // IP capture. `x-forwarded-for` is the de-facto reverse-proxy
  // header; the first entry is the original client (subsequent ones
  // are intermediate proxies we don't care about). Trim because some
  // proxies pad with spaces.
  const xff = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  const ipAddress = xff?.split(",")[0]?.trim() || realIp?.trim() || null;

  // Vercel geo headers. Set on every edge-routed request to a
  // Vercel deployment; absent everywhere else. The `decodeURIComponent`
  // handles characters Vercel URL-encodes for transport (e.g. spaces
  // in "New York").
  const geoCity = decodeOrNull(req.headers.get("x-vercel-ip-city"));
  const geoCountry = decodeOrNull(req.headers.get("x-vercel-ip-country"));
  const geoRegion = decodeOrNull(req.headers.get("x-vercel-ip-country-region"));

  const userAgent = body.userAgent ?? null;
  const nowIso = new Date().toISOString();

  // Lookup priority: device_id → session_id. The first hit wins.
  // Both branches are best-effort reads — Supabase errors on either
  // fall through to the INSERT, which is safe because the unique
  // indexes will reject a true duplicate.
  let existing: { id: string } | null = null;
  if (deviceId) {
    const r = await supabase
      .from("user_devices")
      .select("id")
      .eq("user_id", user.id)
      .eq("device_id", deviceId)
      .maybeSingle();
    existing = (r.data ?? null) as { id: string } | null;
  }
  if (!existing) {
    const r = await supabase
      .from("user_devices")
      .select("id")
      .eq("user_id", user.id)
      .eq("session_id", sessionId)
      .maybeSingle();
    existing = (r.data ?? null) as { id: string } | null;
  }

  if (existing) {
    // UPDATE the row. session_id and device_id both refresh because:
    //   - session_id rotates each sign-in (most-recent is what the
    //     unregister-by-session-id fallback expects to find).
    //   - device_id may be a backfill on a legacy row whose
    //     localStorage just started reporting one.
    // The device_label stays untouched so user renames survive
    // re-registration.
    const { error: updErr } = await supabase
      .from("user_devices")
      .update({
        session_id: sessionId,
        device_id: deviceId,
        last_seen_at: nowIso,
        ip_address: ipAddress,
        geo_city: geoCity,
        geo_country: geoCountry,
        geo_region: geoRegion,
        user_agent: userAgent,
      })
      .eq("id", existing.id);
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id: existing.id, created: false });
  }

  const { data: inserted, error: insErr } = await supabase
    .from("user_devices")
    .insert({
      user_id: user.id,
      session_id: sessionId,
      device_id: deviceId,
      device_label: body.deviceLabel?.trim() ?? null,
      user_agent: userAgent,
      ip_address: ipAddress,
      geo_city: geoCity,
      geo_country: geoCountry,
      geo_region: geoRegion,
      first_seen_at: nowIso,
      last_seen_at: nowIso,
    })
    .select("id")
    .maybeSingle();
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: inserted?.id, created: true });
}

/** Vercel URL-encodes special chars in the geo headers (spaces,
 *  non-ASCII letters). Decode if present; null otherwise. Empty
 *  strings from non-Vercel deployments also normalize to null so
 *  the column stays semantically "unknown" rather than "" which
 *  would render as a broken comma in the UI. */
function decodeOrNull(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    return decoded.length > 0 ? decoded : null;
  } catch {
    return raw.length > 0 ? raw : null;
  }
}
