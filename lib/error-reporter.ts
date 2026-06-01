import { APP_VERSION } from "@/lib/version";

/** Privacy-preserving error reporter. Fire-and-forget — never
 *  awaited by callers, never throws back at them. If the ingest
 *  fails (offline, route down, rate-limited), the error is silently
 *  dropped on the floor: we'd rather lose a report than disrupt
 *  the user-facing flow that triggered it.
 *
 *  Two surfaces:
 *    - `reportClientError`  — used from the browser; POSTs to
 *      `/api/errors`.
 *    - `reportServerError`  — used from route handlers; inserts
 *      directly via the service-role client.
 *
 *  Both funnel through the same `error_log` row shape and the same
 *  scrubbing logic in [sanitizeContext](#L70). Add or remove
 *  fields from the wire format in [makePayload](#L52) — the
 *  database column set stays in sync via migration 0015.
 *
 *  No PII by design: no email, no user_id, no IP. A
 *  sessionStorage-rotated token correlates events within a single
 *  tab session for triage. */

export type ErrorLevel = "error" | "warning";

export type ReportErrorOptions = {
  /** "page" or "/api/route" — the originating context. Falls back
   *  to `window.location.pathname` when not specified. */
  route?: string;
  /** Defaults to "error". Use "warning" for recoverable
   *  degradations we want visibility on without alerting. */
  level?: ErrorLevel;
  /** Free-form structured context. Callers are responsible for
   *  scrubbing identifiers BEFORE handing it to us — we apply a
   *  best-effort sanitizer but defense in depth. */
  context?: Record<string, unknown>;
  /** Optional caller-supplied user id. When present AND that user
   *  has `profiles.traced = true` (set via the admin Users
   *  dashboard), the reporter:
   *   - does NOT truncate the stack to 8000 chars
   *   - tags the row by adding `_traced_user: <id>` to the
   *     context bag
   *  When the user is not traced (or no userId is provided), this
   *  field has no effect — the normal "no PII" privacy posture
   *  applies. The trace lookup is server-side only; client-side
   *  reports ignore this field entirely. */
  userId?: string;
};

type ErrorPayload = {
  app_version: string;
  route: string;
  level: ErrorLevel;
  message: string;
  stack?: string;
  user_agent?: string;
  session_token?: string;
  context?: Record<string, unknown>;
};

const SESSION_TOKEN_KEY = "maqro:error-session";

function getOrCreateSessionToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const existing = window.sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (existing) return existing;
    // Math.random is fine — this is a correlation token, not a
    // security boundary. crypto.randomUUID isn't universally
    // available in all browser/storage combos we care about.
    const token = Math.random().toString(36).slice(2, 10);
    window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    return token;
  } catch {
    return undefined;
  }
}

function sanitizeContext(
  ctx: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!ctx) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    // Drop anything that *looks* identity-bearing. Callers should
    // already not include these, but a defensive filter catches
    // the cases where they slipped through.
    if (/email|token|password|secret|auth|user_id|userid/i.test(k)) continue;
    if (typeof v === "string" && v.length > 2000) {
      // Cap long strings — usually it's an HTML response body
      // someone tossed into context. Truncate, don't drop.
      out[k] = `${v.slice(0, 2000)}…[truncated]`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function makePayload(
  err: unknown,
  opts: ReportErrorOptions,
  source: "client" | "server",
): ErrorPayload {
  const message =
    err instanceof Error ? err.message : String(err ?? "Unknown error");
  const stack = err instanceof Error ? err.stack : undefined;
  const route =
    opts.route ??
    (source === "client" && typeof window !== "undefined"
      ? window.location.pathname
      : "unknown");
  return {
    app_version: APP_VERSION,
    route,
    level: opts.level ?? "error",
    message: message.slice(0, 1000),
    stack: stack?.slice(0, 8000),
    user_agent:
      typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    session_token: getOrCreateSessionToken(),
    context: sanitizeContext(opts.context),
  };
}

/** Fire-and-forget client-side error report. Always returns
 *  immediately; the POST happens in the background. */
export function reportClientError(
  err: unknown,
  opts: ReportErrorOptions = {},
): void {
  if (typeof window === "undefined") return;
  // Kill-switch: a maintainer can disable the route at the
  // deployment level via env without rebuilding the bundle.
  if (process.env.NEXT_PUBLIC_ERROR_LOG_DISABLED === "1") return;
  const payload = makePayload(err, opts, "client");
  // `keepalive: true` lets the request survive page unload, which
  // matters for errors fired during navigation away from a route.
  void fetch("/api/errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    // Swallow — see header. Don't surface ingest failures.
  });
}

/** Server-side error report. Uses the service-role client to
 *  insert directly. Async but callers can `void` it — the
 *  promise is informational, not load-bearing. */
export async function reportServerError(
  err: unknown,
  opts: ReportErrorOptions = {},
): Promise<void> {
  if (process.env.ERROR_LOG_DISABLED === "1") return;
  try {
    // Lazy-import to keep the client bundle from pulling in
    // server-only Supabase modules.
    const { getSupabaseSecretConfig } = await import("@/lib/supabase/env");
    const { createClient } = await import("@supabase/supabase-js");
    const config = getSupabaseSecretConfig();
    if (!config) return;
    const admin = createClient(config.url, config.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const payload = makePayload(err, opts, "server");

    // Trace-flag enrichment: when the caller supplied a userId AND
    // that user is admin-traced (`profiles.traced = true`), keep
    // the full stack and tag the row so the operator can filter
    // for it later (`context->>'_traced_user' = '<id>'`). The
    // user id lands in the JSONB context bag rather than a
    // top-level column — keeps the schema unchanged and confines
    // the PII to opt-in rows.
    //
    // `isUserTraced` lives in `lib/admin-trace.ts` and is the
    // SAME cache the proxy auto-capture uses, so a flag toggle
    // propagates to both surfaces in one TTL window.
    if (opts.userId) {
      const { isUserTraced } = await import("@/lib/admin-trace");
      if (await isUserTraced(opts.userId)) {
        const stack = err instanceof Error ? err.stack : undefined;
        if (stack) payload.stack = stack;
        payload.context = {
          ...(payload.context ?? {}),
          _traced_user: opts.userId,
        };
        // Also drop a structured row into trace_events so the
        // operator sees the error in the per-user trace panel
        // without leaving the page. Fire-and-forget.
        const { recordTraceEvent } = await import("@/lib/admin-trace");
        void recordTraceEvent({
          userId: opts.userId,
          kind: "error",
          path: opts.route,
          payload: {
            message: payload.message,
            level: payload.level,
            // Don't include the stack — it's already in error_log;
            // duplicating it here doubles storage for no gain.
          },
        });
      }
    }

    await admin.from("error_log").insert(payload);
  } catch {
    // Reporting errors is best-effort. If the reporter itself
    // throws we drop it — recursive failure is worse than silent
    // failure.
  }
}
