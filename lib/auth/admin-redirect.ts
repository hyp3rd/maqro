import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** Admin gate for GET route handlers that should REDIRECT a non-admin (back to
 *  the app / login) rather than return a JSON error like `requireAdmin` does.
 *  Returns a redirect Response to bounce the caller, or null when they're an
 *  admin and the route may proceed. */
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
