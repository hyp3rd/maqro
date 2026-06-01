import { assertFreshAal2 } from "@/lib/auth/mfa-required";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Server-side RBAC primitives.
 *
 *  Two surfaces:
 *    - `currentUserRole()` - reads the caller's role for UX use
 *      (conditionally rendering an admin link, for instance).
 *    - `requireAdmin()` - gate for server actions and API
 *      routes. Returns either the admin's user_id or a 401/403
 *      `NextResponse` the caller should `return` directly.
 *
 *  We re-read the role on every request - there's no caching by
 *  design. The set of admins is tiny (single digits) and the
 *  cost of an extra small SELECT is dwarfed by the safety win
 *  of always reading authoritative state. Caching here was the
 *  root of more than one historical privilege-escalation bug
 *  in other apps. */

export type Role = "user" | "admin";

/** Read the caller's role from `profiles.role`. Returns `"user"`
 *  by default - including when the user isn't signed in or the
 *  Supabase client isn't configured - so callers can treat the
 *  string as a safe default without an undefined check. */
export async function currentUserRole(): Promise<Role> {
  const supabase = await getSupabaseServer();
  if (!supabase) return "user";
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "user";
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  return (profile?.role as Role | undefined) === "admin" ? "admin" : "user";
}

export type RequireAdminResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

/** Guard for admin-only API routes. Usage:
 *
 *    const guard = await requireAdmin();
 *    if (!guard.ok) return guard.response;
 *    // ...proceed with guard.userId in scope
 *
 *  Returns shapes:
 *    - 401 when no user is signed in.
 *    - 403 when the user is signed in but not an admin.
 *    - 503 when Supabase isn't configured (so the route fails
 *      gracefully on misconfigured deployments rather than
 *      crashing). */
export async function requireAdmin(): Promise<RequireAdminResult> {
  const supabase = await getSupabaseServer();
  if (!supabase) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Supabase is not configured." },
        { status: 503 },
      ),
    };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }
  // MFA assertion runs BEFORE the role check on purpose: an admin
  // user with an AAL1 session shouldn't even be told their role
  // until they've completed the second factor. The `mfa-required`
  // 403 response is what the client uses to prompt completion;
  // the role-mismatch 403 reads as "not an admin" which is the
  // wrong signal here. Order matters for the right error shape.
  //
  // Strict gate: admin routes deliberately ignore the trusted-device
  // escape hatch. Every admin endpoint either reads sensitive PII
  // (audit log, error log, user details, trace events) or performs
  // a privileged mutation (role grant, ban, force-signout, settings
  // change, webhook replay). The 7-day trust grant is fine for
  // routine user-side mutations; an admin who's borrowed-laptop'd
  // shouldn't be one click away from granting themselves the keys.
  // The admin still types their TOTP code only ONCE per session
  // (the AAL2 promotion lasts as long as the auth cookie), so the
  // friction is bounded.
  const gate = await assertFreshAal2(supabase);
  if (!gate.ok) return { ok: false, response: gate.response };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
    };
  }
  return { ok: true, userId: user.id };
}

/** Write a single audit-log row. Fire-and-forget (caller can
 *  `void` the promise) - the row is informational and we never
 *  want logging to break the action itself. Errors are swallowed
 *  to stderr.
 *
 *  Uses the service-role client so the INSERT bypasses RLS (the
 *  table has no public write policy). */
export async function writeAuditLog(opts: {
  adminUserId: string;
  action: string;
  targetUserId?: string | null;
  payload?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const config = getSupabaseSecretConfig();
    if (!config) return;
    const admin = createClient(config.url, config.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await admin
      .from("admin_audit_log")
      .insert({
        admin_user_id: opts.adminUserId,
        action: opts.action,
        target_user_id: opts.targetUserId ?? null,
        payload: opts.payload ?? null,
      });
  } catch (err) {
    console.error("[audit] write failed:", err);
  }
}
