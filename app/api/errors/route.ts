import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Client-error ingest. Accepts a single error event per POST and
 *  writes it to the [error_log](../../supabase/migrations/0015_error_log.sql)
 *  table via the service-role client.
 *
 *  Auth model: no user auth. Errors are reported anonymously by
 *  design (see [lib/error-reporter.ts](../../../lib/error-reporter.ts)).
 *  Without per-user auth, we lean on two boundaries:
 *
 *    1. **Body validation** - strict shape; oversized payloads
 *       rejected.
 *    2. **Per-IP rate limit** - 30 events / minute / IP, naive
 *       in-memory token bucket. Survives one tab spewing errors
 *       without choking the database; resets on cold start
 *       (acceptable trade-off for an MVP). If we grow past a
 *       single server instance, this moves to Redis / Upstash.
 *
 *  We deliberately do NOT enable CORS - the route is for
 *  same-origin clients only. */

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const MAX_BODY_BYTES = 16 * 1024; // 16 KB - plenty for one event

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > RATE_LIMIT_MAX;
}

type IncomingPayload = {
  app_version?: unknown;
  route?: unknown;
  level?: unknown;
  message?: unknown;
  stack?: unknown;
  user_agent?: unknown;
  session_token?: unknown;
  context?: unknown;
};

function validate(p: IncomingPayload): {
  ok: boolean;
  row?: Record<string, unknown>;
} {
  // `message` is the one absolutely required field - an error
  // event with no message is noise.
  if (typeof p.message !== "string" || p.message.length === 0) {
    return { ok: false };
  }
  const level = p.level === "warning" ? "warning" : "error";
  return {
    ok: true,
    row: {
      app_version: typeof p.app_version === "string" ? p.app_version : null,
      route: typeof p.route === "string" ? p.route.slice(0, 200) : "unknown",
      level,
      message: p.message.slice(0, 1000),
      stack: typeof p.stack === "string" ? p.stack.slice(0, 8000) : null,
      user_agent:
        typeof p.user_agent === "string" ? p.user_agent.slice(0, 500) : null,
      session_token:
        typeof p.session_token === "string"
          ? p.session_token.slice(0, 32)
          : null,
      context:
        p.context && typeof p.context === "object" && !Array.isArray(p.context)
          ? p.context
          : null,
    },
  };
}

export async function POST(req: Request): Promise<NextResponse> {
  if (process.env.ERROR_LOG_DISABLED === "1") {
    // Kill-switch for the maintainer to disable ingest without
    // a rebuild. The client also has its own kill-switch via
    // NEXT_PUBLIC_ERROR_LOG_DISABLED - having both means we can
    // stop the firehose at either side.
    return NextResponse.json({ skipped: true }, { status: 200 });
  }

  // Crude IP read. `x-forwarded-for` is the canonical header
  // behind Vercel's edge; fall back to a fixed key so even
  // requests without an XFF still hit the limiter (rather than
  // bypassing it entirely).
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Rate limited." }, { status: 429 });
  }

  // Cheap body size check before parsing - protects against a
  // client pushing megabytes of stack traces.
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }

  let body: IncomingPayload;
  try {
    body = (await req.json()) as IncomingPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { ok, row } = validate(body);
  if (!ok || !row) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const config = getSupabaseSecretConfig();
  if (!config) {
    // Supabase not configured - the route stays available so the
    // client doesn't keep retrying, but we can't actually
    // persist anything.
    return NextResponse.json({ skipped: true }, { status: 200 });
  }

  const admin = createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: insertError } = await admin.from("error_log").insert(row);
  if (insertError) {
    // The reporter can't itself report (would loop). Log to
    // server stderr so Vercel logs catch it.
    console.error("[errors/ingest] insert failed:", insertError);
    return NextResponse.json({ error: "Persist failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
