import { reportServerError } from "@/lib/error-reporter";
import { ipFromRequest } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

/** Cloudflare Turnstile server-side verification — a managed bot challenge that
 *  AUGMENTS the BotID gate on the public, email-sending forms (login code,
 *  account recovery, contact, backup-email setup).
 *
 *  Optional integration: with no `TURNSTILE_SECRET_KEY` set, every check is a
 *  no-op (the widget also renders nothing client-side), so dev / vitest and
 *  deploys without keys behave exactly as before. When configured, it is
 *  FAIL-CLOSED: a missing token, a bad / expired / replayed token, a non-200
 *  from siteverify, or any network error all reject — matching the
 *  `requireHumanDeep` posture. Tokens are single-use and live 5 minutes. */

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type VerifyResult = { ok: true } | { ok: false; reason: string };

/** Verify a Turnstile token against Cloudflare's siteverify, binding the
 *  caller's IP. Returns ok ONLY on `success: true` (or when unconfigured).
 *  `reason` is for server logs, never for the user. */
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp: string | null,
): Promise<VerifyResult> {
  // Trim defensively: a secret pasted from the Cloudflare dashboard with a
  // trailing space/newline would otherwise siteverify as `invalid-input-secret`.
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return { ok: true };
  if (!token) return { ok: false, reason: "missing-token" };

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return { ok: false, reason: `siteverify-http-${res.status}` };
    const data = (await res.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };
    if (data.success === true) return { ok: true };
    const codes = data["error-codes"];
    return {
      ok: false,
      reason:
        Array.isArray(codes) && codes.length > 0
          ? codes.join(",")
          : "verify-failed",
    };
  } catch {
    // Fail-closed: a siteverify outage rejects rather than waving traffic past.
    return { ok: false, reason: "network-error" };
  }
}

/** Route gate: verify the request's Turnstile token (IP-bound) and return a 403
 *  on failure. Call AFTER body parsing, alongside the BotID gate. No-op (ok)
 *  when Turnstile is unconfigured. */
export async function requireTurnstile(
  token: string | null | undefined,
  req: Request,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const result = await verifyTurnstile(token, ipFromRequest(req));
  if (result.ok) return { ok: true };
  // Observability: a fail-closed gate that logs nothing is undiagnosable in
  // production (was this a misconfigured secret, an expired token, or a real
  // bot?). The reason is a Cloudflare error-code — never the secret or the
  // token — so it's safe to record. Skip the bare `missing-token` case: that's
  // the expected shape of a script hitting the endpoint without solving the
  // widget, and logging it would just flood the error log with bot noise.
  if (result.reason !== "missing-token") {
    await reportServerError(
      new Error(`turnstile verification failed: ${result.reason}`),
      {
        route: pathOf(req),
        context: { gate: "turnstile", reason: result.reason },
      },
    );
  }
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: "Couldn't verify you're human. Refresh the page and try again.",
      },
      { status: 403 },
    ),
  };
}

/** Best-effort request path for log context (never throws on a malformed URL). */
function pathOf(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return "(unknown)";
  }
}
