import type { UsageDenial } from "@/lib/billing/usage";
import { NextResponse } from "next/server";

/** Seconds a client should wait before retrying after a metering outage.
 *  Short: the usual cause is a transient database or network blip. */
const METERING_RETRY_AFTER_SECONDS = 30;

/** The HTTP response for an AI call that `checkAndIncrementAiUsage`
 *  refused. Shared by every metered AI route so the wire contract stays
 *  identical:
 *
 *  - cap reached: 402 `{ error, used, cap, kind: "ai-cap-reached" }`. The
 *    clients key their upgrade / "N of M used" UI off `kind` and status.
 *  - metering unavailable: 503 `{ error, kind: "ai-metering-unavailable" }`
 *    with `Retry-After`. Metering fails closed, so the model was not
 *    called and nothing was charged. */
export function aiUsageDeniedResponse(denial: UsageDenial): NextResponse {
  if (denial.reason === "metering-unavailable") {
    return NextResponse.json(
      {
        error:
          "AI features are temporarily unavailable because usage tracking is down. Please try again in a moment.",
        kind: "ai-metering-unavailable",
      },
      {
        status: 503,
        headers: { "Retry-After": String(METERING_RETRY_AFTER_SECONDS) },
      },
    );
  }
  return NextResponse.json(
    {
      error: "AI usage cap reached for this month.",
      used: denial.used,
      cap: denial.cap,
      kind: "ai-cap-reached",
    },
    { status: 402 },
  );
}
