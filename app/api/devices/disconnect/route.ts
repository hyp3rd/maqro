import { parseBody } from "@/lib/api/parse-body";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const BodySchema = z.object({ deviceId: z.string().min(1) });

/** Disconnect a remote device.
 *
 *  Flow:
 *    1. Authenticate the caller via the cookie-bound server client.
 *    2. Look up the caller's CURRENT device row (matched by the
 *       session_id of the caller's own JWT) and assert that its
 *       `first_seen_at` is older than 12 hours. This is the grace
 *       window: a freshly-signed-in session can't immediately kick
 *       other devices off — that protects a legitimate user from
 *       a stolen-session attacker who logs in and tries to lock
 *       them out before they notice.
 *    3. Look up the target device row by `id`, scoped to the
 *       caller's user_id (the SELECT under RLS already enforces
 *       this, but the explicit eq makes the intent obvious).
 *    4. Refuse if the caller picked their own device — that's a
 *       sign-out, not a disconnect; the right UI sends them to
 *       /api/auth/logout (or just supabase.auth.signOut() client-
 *       side).
 *    5. Service-role SQL: delete from `auth.refresh_tokens` and
 *       `auth.sessions` for the target session_id. This invalidates
 *       the target's refresh chain immediately. The current access
 *       token on the kicked device works until it expires (≤ 1 h),
 *       after which the refresh-token rotation fails and the SDK
 *       fires `SIGNED_OUT`. The Settings UI on the kicked device
 *       also gets the realtime DELETE event on its `user_devices`
 *       row (see the realtime listener) and proactively wipes IDB.
 *    6. Delete the `user_devices` row.
 *
 *  Auth: cookie-bound supabase client. Service-role used only for the
 *  cross-schema deletes; we never expose it to the client.
 *
 *  Errors: returns 4xx with a JSON `{ error }` payload for cases the
 *  UI should surface (grace not met, target not found, etc.) and 5xx
 *  for unexpected failures. */

const GRACE_HOURS = 12;
const GRACE_MS = GRACE_HOURS * 60 * 60 * 1000;

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
  const deviceId = parsed.data.deviceId.trim();
  if (!deviceId) {
    return NextResponse.json({ error: "Missing deviceId." }, { status: 400 });
  }

  // Caller's own session_id: read straight from the cookie-bound
  // session. This is the identifier we use to enforce the grace
  // window AND to refuse self-disconnect.
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  const callerSessionId = accessToken
    ? parseSessionIdFromAccessToken(accessToken)
    : null;
  if (!callerSessionId) {
    return NextResponse.json(
      { error: "Couldn't identify the calling session." },
      { status: 400 },
    );
  }

  // Pull the caller's own device row to check first_seen_at. RLS
  // restricts to the caller's user_id so the eq is structurally
  // safe even if user_id were ever spoofable in the cookie (it
  // isn't, but defense in depth).
  const { data: callerRow, error: callerErr } = await supabase
    .from("user_devices")
    .select("id, first_seen_at, session_id")
    .eq("user_id", user.id)
    .eq("session_id", callerSessionId)
    .maybeSingle();
  if (callerErr) {
    return NextResponse.json({ error: callerErr.message }, { status: 500 });
  }
  if (!callerRow) {
    // The caller's device isn't registered yet (first sync hasn't
    // completed, or the registration row was manually deleted).
    // Refuse rather than auto-register here: the grace check is
    // meaningless if we haven't observed the caller for any time.
    return NextResponse.json(
      {
        error:
          "This device isn't registered yet. Reload the page and try again in a moment.",
      },
      { status: 409 },
    );
  }
  const firstSeenMs = Date.parse(callerRow.first_seen_at as string);
  const ageMs = Date.now() - firstSeenMs;
  if (ageMs < GRACE_MS) {
    const hoursLeft = Math.ceil((GRACE_MS - ageMs) / (60 * 60 * 1000));
    return NextResponse.json(
      {
        error: `For security, this device can disconnect other devices ${GRACE_HOURS} hours after sign-in. Try again in about ${hoursLeft} hour${hoursLeft === 1 ? "" : "s"}.`,
        graceHoursRemaining: hoursLeft,
      },
      { status: 403 },
    );
  }

  // Fetch the target row — must belong to the same user and not be
  // the caller's own device.
  const { data: targetRow, error: targetErr } = await supabase
    .from("user_devices")
    .select("id, session_id")
    .eq("user_id", user.id)
    .eq("id", deviceId)
    .maybeSingle();
  if (targetErr) {
    return NextResponse.json({ error: targetErr.message }, { status: 500 });
  }
  if (!targetRow) {
    return NextResponse.json({ error: "Device not found." }, { status: 404 });
  }
  if (targetRow.session_id === callerSessionId) {
    return NextResponse.json(
      {
        error:
          "Use Sign out (or Reset device) for the current device — Disconnect is for other devices.",
      },
      { status: 400 },
    );
  }

  // Service-role path: revoke the target session at the auth layer.
  // Done in two stages because GoTrue doesn't expose a single
  // "revoke session" admin endpoint; the FK between refresh_tokens
  // and sessions does the rest if we delete in the right order.
  const adminConfig = getSupabaseSecretConfig();
  if (!adminConfig) {
    return NextResponse.json(
      { error: "Server-side admin client isn't configured." },
      { status: 503 },
    );
  }
  const admin = createClient(adminConfig.url, adminConfig.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Invalidate the auth-side session via the SECURITY DEFINER RPC
  // defined in migration 0022. Best-effort: if the call fails (RPC
  // not present, role lost privileges, etc.) we still proceed to
  // delete the user_devices row — the worst case becomes the target
  // device's access token stays valid until expiry (≤ 1h), after
  // which its refresh fails because the realtime listener already
  // signed it out client-side.
  const { error: invalidateErr } = await admin.rpc("invalidate_user_session", {
    target_session_id: targetRow.session_id,
  });
  if (invalidateErr) {
    console.warn(
      "[devices/disconnect] invalidate_user_session RPC failed:",
      invalidateErr.message,
    );
  }

  // Finally, delete the public.user_devices row. The realtime DELETE
  // event on this row is what triggers the kicked device's client
  // to wipe IDB and redirect to /login.
  const { error: rowDeleteErr } = await admin
    .from("user_devices")
    .delete()
    .eq("id", deviceId)
    .eq("user_id", user.id);
  if (rowDeleteErr) {
    return NextResponse.json({ error: rowDeleteErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/** Lightweight server-side JWT payload reader. Duplicated from
 *  `lib/devices/identity.ts` because that module is "use client" —
 *  importing it from a route handler would pull a client bundle into
 *  the server graph. Both implementations stay tiny and side-effect-
 *  free, so the duplication beats a shared module that has to be
 *  careful about both runtimes. */
function parseSessionIdFromAccessToken(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = JSON.parse(
      Buffer.from(padded, "base64").toString("utf8"),
    ) as { session_id?: string };
    return decoded.session_id ?? null;
  } catch {
    return null;
  }
}
