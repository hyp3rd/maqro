import { describe, expect, it } from "vitest";
import { aiUsageDeniedResponse } from "./usage-response";

describe("aiUsageDeniedResponse", () => {
  it("maps cap-reached to the 402 contract the clients key off", async () => {
    const res = aiUsageDeniedResponse({
      allowed: false,
      reason: "cap-reached",
      tier: "free",
      used: 25,
      cap: 25,
    });

    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      error: "AI usage cap reached for this month.",
      used: 25,
      cap: 25,
      kind: "ai-cap-reached",
    });
  });

  it("maps a metering outage to a retryable 503", async () => {
    const res = aiUsageDeniedResponse({
      allowed: false,
      reason: "metering-unavailable",
    });

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("30");
    const body = (await res.json()) as { kind: string; error: string };
    expect(body.kind).toBe("ai-metering-unavailable");
    expect(body.error).toMatch(/temporarily unavailable/i);
  });
});
