import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { getCurrentMonthUsage } from "@/lib/billing/usage";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** GET the caller's current-month AI usage. Powers the "AI calls
 *  left this month" indicator in Settings and the paywall message
 *  when one of the AI routes returns 402. Read-only — the
 *  side-effecting increment happens inside the AI route itself, not
 *  here. */
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
  const usage = await getCurrentMonthUsage(supabase, user.id);
  return NextResponse.json(usage);
}
