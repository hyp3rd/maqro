import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { createClient } from "@supabase/supabase-js";

/** Admin-trace mechanism. The `profiles.traced` flag (migration
 *  0033) was previously a gimmick — toggling it did nothing.
 *  This module makes it real:
 *
 *    - `isUserTraced(userId)` — cached lookup. Used by the
 *      proxy middleware on every request and by the error
 *      reporter when a server-side error is tied to a known
 *      user. 60-second per-process cache so the hot path is
 *      ~free.
 *
 *    - `recordTraceEvent({ userId, kind, ... })` — fire-and-
 *      forget write to `trace_events` (migration 0035). Checks
 *      `isUserTraced` first so callers can call unconditionally
 *      without worrying about whether the user is flagged.
 *      Used by the proxy auto-capture and by route handlers
 *      that want to record significant actions explicitly (admin
 *      actions, AI calls, subscription changes).
 *
 *  All writes go through the service-role client; the table has
 *  no public INSERT/UPDATE/DELETE policies. Reads happen via the
 *  user-detail page using the same client (RLS-gated on admin
 *  role for cross-user visibility).
 *
 *  Why a single module for both lookup + recording:
 *
 *    - The cache MUST be shared. If the error reporter and the
 *      proxy held independent caches, a flag toggle would have
 *      double the propagation delay.
 *    - The recording path NEEDS the lookup before writing —
 *      defeats the purpose to write rows for untraced users
 *      (we'd recover via filtering at read time but at the cost
 *      of useless DB load on the hot path). */

type TracedCacheEntry = { traced: boolean; expiresAt: number };

const TRACED_CACHE = new Map<string, TracedCacheEntry>();
const TRACED_CACHE_TTL_MS = 60_000;

function adminClient() {
  const config = getSupabaseSecretConfig();
  if (!config) return null;
  return createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Is this user currently flagged for tracing? 60s in-memory
 *  cache — flag toggles take effect within that window on each
 *  server process. Used by the proxy on every signed-in request
 *  and by the error reporter on server-side errors, so the
 *  cache is load-bearing for performance.
 *
 *  Returns `false` on any failure (lookup error, missing
 *  Supabase config, missing profile row). Default-deny is the
 *  right posture here — a lookup failure should never make a
 *  request slower or accidentally enable trace capture. */
export async function isUserTraced(userId: string): Promise<boolean> {
  const cached = TRACED_CACHE.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.traced;
  try {
    const admin = adminClient();
    if (!admin) return false;
    const { data } = await admin
      .from("profiles")
      .select("traced")
      .eq("user_id", userId)
      .maybeSingle();
    const traced = (data as { traced?: boolean } | null)?.traced === true;
    TRACED_CACHE.set(userId, {
      traced,
      expiresAt: Date.now() + TRACED_CACHE_TTL_MS,
    });
    return traced;
  } catch {
    return false;
  }
}

/** Explicit invalidation hook — called by the trace/untrace
 *  admin action so the next request from this user picks up
 *  the new flag without waiting out the 60s TTL. */
export function invalidateTracedCache(userId: string): void {
  TRACED_CACHE.delete(userId);
}

export type TraceEventInput = {
  userId: string;
  /** Free-text discriminator. Project conventions so far:
   *   - 'http'         — auto-captured API request (proxy)
   *   - 'admin.action' — explicit admin action on the user
   *   - 'ai.call'      — AI request (future)
   *  Use lowercase dotted segments; add new kinds as needed. */
  kind: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  payload?: Record<string, unknown> | null;
};

/** Fire-and-forget write of one trace event. No-ops when the
 *  user isn't flagged. Returns void; never throws — observability
 *  must never break the action that triggered it. Callers can
 *  `void` the promise.
 *
 *  Cost when the user isn't traced: one cached `isUserTraced`
 *  read (sub-millisecond) and an early return. Cost when traced:
 *  one async DB insert that runs in the background. */
export async function recordTraceEvent(input: TraceEventInput): Promise<void> {
  try {
    if (!(await isUserTraced(input.userId))) return;
    const admin = adminClient();
    if (!admin) return;
    await admin
      .from("trace_events")
      .insert({
        user_id: input.userId,
        kind: input.kind,
        method: input.method ?? null,
        path: input.path ?? null,
        status: input.status ?? null,
        duration_ms: input.durationMs ?? null,
        ip_address: input.ipAddress ?? null,
        user_agent: input.userAgent ?? null,
        payload: input.payload ?? null,
      });
  } catch {
    // Best-effort. Recording-side failure can't be allowed to
    // block the actual work.
  }
}

export type TraceEventRow = {
  id: string;
  created_at: string;
  kind: string;
  method: string | null;
  path: string | null;
  status: number | null;
  duration_ms: number | null;
  ip_address: string | null;
  user_agent: string | null;
  payload: Record<string, unknown> | null;
};

/** Read the most-recent trace events for one user, newest first.
 *  Drives the user-detail-page panel. Returns `null` only when
 *  Supabase isn't configured (the caller renders a "not
 *  configured" state); an empty array means the user is traced
 *  but no events have landed yet. */
export async function listTraceEvents(
  userId: string,
  limit = 50,
): Promise<TraceEventRow[] | null> {
  const admin = adminClient();
  if (!admin) return null;
  const { data } = await admin
    .from("trace_events")
    .select(
      "id, created_at, kind, method, path, status, duration_ms, ip_address, user_agent, payload",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as TraceEventRow[] | null) ?? [];
}
