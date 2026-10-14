import { requiresMfaUpgrade } from "@/lib/auth/mfa-required";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** Admin gate for GET route handlers that should REDIRECT a non-admin (back to
 *  the app / login) rather than return a JSON error like `requireAdmin` does.
 *  Returns a redirect Response to bounce the caller, or null when they're an
 *  admin and the route may proceed.
 *
 *  Same order as `requireAdmin`: the second factor is enforced BEFORE the role
 *  lookup, so an AAL1 session for an enrolled user is sent to the two-step
 *  prompt (`/login?mfa=required`, which returns to `returnTo` afterwards) and
 *  never learns whether the account is an admin. */
export async function adminRedirectGuard(
  request: Request,
  returnTo = "/admin",
): Promise<Response | null> {
  const supabase = await getSupabaseServer();
  if (!supabase) return NextResponse.redirect(new URL("/app", request.url));
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(returnTo)}`, request.url),
    );
  }
  const decision = await requiresMfaUpgrade(supabase, user);
  if (decision.needsUpgrade) {
    const login = new URL("/login", request.url);
    login.searchParams.set("mfa", "required");
    login.searchParams.set("next", returnTo);
    return NextResponse.redirect(login);
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return NextResponse.redirect(new URL("/app", request.url));
  }
  return null;
}
