import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import type { CapturePollResponse } from "@/lib/capture/types";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Polling endpoint. The laptop, signed in, polls this every 2 s while
 *  the user is at the phone. Returns `{ ready: false }` until the
 *  phone uploads, then flips to the kind-specific payload. RLS scopes
 *  reads to the calling user, so a leaked session id can't be read by
 *  anyone but its owner. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }
  const { data, error } = await supabase
    .from("captures")
    .select("kind, barcode, photo_path, expires_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    // Either expired (cascade-deleted), never existed, or RLS hid it.
    // The laptop's poll loop treats this as a fatal terminal state.
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  // Expired? Treat as gone — the row may not be cleaned up yet but the
  // session is over. Surfaces as the same 404 the poll loop handles.
  if (new Date(data.expires_at as string).getTime() < Date.now()) {
    return NextResponse.json({ error: "Session expired." }, { status: 404 });
  }
  const kind = data.kind as "photo" | "barcode" | null;
  if (!kind) {
    const out: CapturePollResponse = { ready: false };
    return NextResponse.json(out);
  }
  if (kind === "barcode" && typeof data.barcode === "string") {
    const out: CapturePollResponse = {
      ready: true,
      kind: "barcode",
      barcode: data.barcode,
    };
    return NextResponse.json(out);
  }
  if (kind === "photo" && typeof data.photo_path === "string") {
    const out: CapturePollResponse = {
      ready: true,
      kind: "photo",
      photoPath: data.photo_path,
    };
    return NextResponse.json(out);
  }
  // kind set without payload — shouldn't happen but bail loudly.
  return NextResponse.json(
    { error: "Inconsistent capture state." },
    { status: 500 },
  );
}

/** Cleanup. Called by the laptop after a successful pair so the row +
 *  any Storage object are gone. Best-effort — if the user closes the
 *  laptop mid-flight, the row lingers until the next manual cleanup or
 *  user-delete cascade. */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
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

  // Fetch first so we know what to clean up in Storage. RLS limits us
  // to our own rows — a row for someone else's user_id returns null.
  const { data: row } = await supabase
    .from("captures")
    .select("photo_path")
    .eq("id", id)
    .maybeSingle();

  // Use service-role to drop the Storage object cleanly even if RLS
  // would otherwise interfere with cross-checks. Cookie client deletes
  // the row (RLS-protected — only owner can delete).
  if (row?.photo_path) {
    const secret = getSupabaseSecretConfig();
    if (secret) {
      const admin = createClient(secret.url, secret.secretKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await admin.storage
        .from("captures")
        .remove([row.photo_path as string])
        .catch(() => {
          // Non-fatal — the cron / cascade will clean it up.
        });
    }
  }

  await supabase.from("captures").delete().eq("id", id);
  return new NextResponse(null, { status: 204 });
}
