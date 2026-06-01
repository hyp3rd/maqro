import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** DELETE /api/auth/mfa/trusted-devices/[id] — untrust a single
 *  device (Settings → Trusted devices → row "Remove" button). RLS
 *  scopes the delete to rows owned by the caller, so a malformed /
 *  forged id can't reach into another user's trusts.
 *
 *  Doesn't 404 on a missing row: the user's intent ("this row
 *  shouldn't exist") is satisfied whether or not the row was there
 *  to begin with. Saves a special-case in the UI for "row was
 *  already revoked from another tab". */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
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
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }
  // RLS handles the user-scope; the redundant `.eq` is defense in
  // depth and matches the parent-route's belt-and-braces style.
  const { error } = await supabase
    .from("mfa_trusted_devices")
    .delete()
    .eq("user_id", user.id)
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
