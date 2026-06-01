import { writeAuditLog } from "@/lib/rbac";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";

/** Admin session lifecycle. Brackets the period an operator is
 *  active inside `/admin/*` with start + end events. Powered by
 *  the `admin_sessions` table (migration 0034) and mirrored into
 *  `admin_audit_log` so the audit page surfaces session
 *  transitions alongside everything else operators do.
 *
 *  All writes go through the service-role client. The table has
 *  no public INSERT/UPDATE/DELETE policies; reads are gated on
 *  the caller being an admin. */

const IDLE_TIMEOUT_MS = 30 * 60_000;

type Session = { id: string; started_at: string; last_active_at: string };

function adminClient() {
  const config = getSupabaseSecretConfig();
  if (!config) return null;
  return createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Resolve the originating IP from the proxy chain. Vercel +
 *  Cloudflare both set `x-forwarded-for`; the leftmost entry is
 *  the originating client. Returns null when unavailable
 *  (local dev, direct hits). */
async function callerIp(): Promise<string | null> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip");
}

async function callerUserAgent(): Promise<string | null> {
  const h = await headers();
  return h.get("user-agent");
}

/** Call once per `/admin/*` page render. Two outcomes:
 *
 *    1. An open session for this admin exists AND was active
 *       within IDLE_TIMEOUT_MS → bump `last_active_at` and return.
 *    2. Otherwise → close any stale open sessions with
 *       `ended_reason='idle_timeout'`, then create a fresh
 *       session. Both transitions write audit-log rows.
 *
 *  Returns `null` if Supabase isn't configured. The layout swallows
 *  null silently — session tracking is observability, not a load-
 *  bearing dependency. */
export async function touchAdminSession(
  adminUserId: string,
): Promise<Session | null> {
  const admin = adminClient();
  if (!admin) return null;
  const nowIso = new Date().toISOString();
  const idleCutoff = new Date(Date.now() - IDLE_TIMEOUT_MS).toISOString();

  // Look up the most-recent open session for this admin. Index
  // `admin_sessions_open_idx` covers the query.
  const { data: openRows } = await admin
    .from("admin_sessions")
    .select("id, started_at, last_active_at")
    .eq("admin_user_id", adminUserId)
    .is("ended_at", null)
    .order("last_active_at", { ascending: false })
    .limit(1);
  const open = (openRows?.[0] as Session | undefined) ?? null;

  if (open && open.last_active_at >= idleCutoff) {
    // Still-active session — just bump the heartbeat. No audit
    // row; the start row is enough to bracket the period.
    await admin
      .from("admin_sessions")
      .update({ last_active_at: nowIso })
      .eq("id", open.id);
    return { ...open, last_active_at: nowIso };
  }

  if (open) {
    // Stale open session — close it with the idle reason. The
    // audit row gives the reviewer a marker that the previous
    // bracket ended via timeout rather than an explicit exit.
    await admin
      .from("admin_sessions")
      .update({ ended_at: nowIso, ended_reason: "idle_timeout" })
      .eq("id", open.id);
    await writeAuditLog({
      adminUserId,
      action: "admin.session.end",
      payload: {
        session_id: open.id,
        reason: "idle_timeout",
        duration_seconds: Math.round(
          (Date.parse(nowIso) - Date.parse(open.started_at)) / 1000,
        ),
      },
    });
  }

  // Start a fresh session. Capture IP + UA at start; we don't
  // need to refresh them on every heartbeat (a roaming admin's
  // IP changes are interesting per-session, not within-session).
  const ip = await callerIp();
  const ua = await callerUserAgent();
  const { data: insertedRows } = await admin
    .from("admin_sessions")
    .insert({
      admin_user_id: adminUserId,
      started_at: nowIso,
      last_active_at: nowIso,
      ip_address: ip,
      user_agent: ua,
    })
    .select("id, started_at, last_active_at")
    .limit(1);
  const inserted = (insertedRows?.[0] as Session | undefined) ?? null;
  if (inserted) {
    await writeAuditLog({
      adminUserId,
      action: "admin.session.start",
      payload: { session_id: inserted.id, ip_address: ip, user_agent: ua },
    });
  }
  return inserted;
}

/** Explicit close — the operator clicked "Exit admin". Closes
 *  the most-recent open session with `reason='manual'` and
 *  writes the audit row. Idempotent: a re-call (e.g. double-
 *  click) finds no open session and is a no-op. */
export async function endAdminSession(adminUserId: string): Promise<void> {
  const admin = adminClient();
  if (!admin) return;
  const nowIso = new Date().toISOString();
  const { data: openRows } = await admin
    .from("admin_sessions")
    .select("id, started_at")
    .eq("admin_user_id", adminUserId)
    .is("ended_at", null)
    .order("last_active_at", { ascending: false })
    .limit(1);
  const open = openRows?.[0] as { id: string; started_at: string } | undefined;
  if (!open) return;
  await admin
    .from("admin_sessions")
    .update({ ended_at: nowIso, ended_reason: "manual" })
    .eq("id", open.id);
  await writeAuditLog({
    adminUserId,
    action: "admin.session.end",
    payload: {
      session_id: open.id,
      reason: "manual",
      duration_seconds: Math.round(
        (Date.parse(nowIso) - Date.parse(open.started_at)) / 1000,
      ),
    },
  });
}
