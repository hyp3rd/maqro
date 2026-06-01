import { parseBody } from "@/lib/api/parse-body";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

/** Schema gates shape; deviceId stays as a free string to match the
 *  existing route contract. A bogus value just won't match anything
 *  in the trust lookup downstream — no extra hardening needed here
 *  beyond non-empty. */
const RecordBodySchema = z.object({
  deviceId: z.string().min(1),
  deviceLabel: z.string().max(120).optional(),
  userAgent: z.string().max(500).optional(),
});

/** `/api/auth/mfa/trusted-devices`
 *
 *    - **GET** — list the caller's trusted-device rows for the
 *      Settings UI. Cookie-session auth, RLS scopes to the user.
 *    - **POST** — record a new trust for the current device. MUST
 *      be at AAL2 (i.e. the caller just successfully verified an
 *      MFA factor in this session). Body: `{ deviceId, deviceLabel?,
 *      userAgent? }`. Upserts so re-trusting an already-trusted
 *      device refreshes the window rather than piling up rows.
 *    - **DELETE** — revoke ALL trusted devices for the caller
 *      (Settings: "Untrust all"). Single-device revoke lives in
 *      `[id]/route.ts`.
 *
 *  Default trust window is 7 days from the moment of recording —
 *  consistent with the user-facing copy "Trust this device for 7
 *  days". Window length is a server constant rather than client
 *  input so a malicious client can't extend the lifetime past what
 *  the UI advertises. */

const TRUST_DURATION_MS = 7 * 24 * 60 * 60_000;

/** Resolve the caller's IP from the proxy chain. Vercel + Cloudflare
 *  both set `x-forwarded-for`; we take the leftmost entry which is
 *  the originating client. Returns null when unavailable (local
 *  dev, direct hits with no proxy). */
function ipFromHeaders(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip");
}

export async function GET(): Promise<NextResponse> {
  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const gate = await assertAal2(
    supabase,
    await trustedDeviceOption(supabase, user.id),
  );
  if (!gate.ok) return gate.response;

  // Cookie-session client + RLS does the user-scope filtering for
  // us. We still exclude already-expired rows in the same query so
  // the UI doesn't have to do its own clock math.
  const { data, error } = await supabase
    .from("mfa_trusted_devices")
    .select(
      "id, device_id, device_label, user_agent, ip_address, trusted_at, trusted_until, last_used_at",
    )
    .gt("trusted_until", new Date().toISOString())
    .order("trusted_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Hard gate: the caller MUST have just verified MFA in this
  // session. Without this check, an AAL1 session could record a
  // trust without ever passing the second factor — the whole point
  // of the feature would be lost.
  const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.data?.currentLevel !== "aal2") {
    return NextResponse.json(
      { error: "Must verify MFA before trusting this device." },
      { status: 403 },
    );
  }

  const parsed = await parseBody(req, RecordBodySchema);
  if (!parsed.ok) return parsed.response;
  const { deviceId, deviceLabel, userAgent } = parsed.data;

  const secret = getSupabaseSecretConfig();
  if (!secret) {
    return NextResponse.json(
      { error: "Service-role key not configured." },
      { status: 503 },
    );
  }
  // Writes go through service-role since the RLS policy intentionally
  // forbids client-side INSERT — see the migration header for why.
  const admin = createClient(secret.url, secret.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const now = new Date();
  const trustedUntil = new Date(now.getTime() + TRUST_DURATION_MS);
  const { data, error } = await admin
    .from("mfa_trusted_devices")
    .upsert(
      {
        user_id: user.id,
        device_id: deviceId,
        trusted_at: now.toISOString(),
        trusted_until: trustedUntil.toISOString(),
        user_agent: userAgent ?? null,
        ip_address: ipFromHeaders(req),
        device_label: deviceLabel ?? null,
        last_used_at: now.toISOString(),
      },
      { onConflict: "user_id,device_id" },
    )
    .select("id, trusted_until")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data?.id, trustedUntil: data?.trusted_until });
}

export async function DELETE(): Promise<NextResponse> {
  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  // RLS policy `mfa_trusted_devices_self_delete` scopes to
  // `auth.uid() = user_id`, so we don't need an explicit `.eq` —
  // the policy is doing the right job. The redundant filter here
  // is defense in depth in case the policy is ever loosened.
  const { error } = await supabase
    .from("mfa_trusted_devices")
    .delete()
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
