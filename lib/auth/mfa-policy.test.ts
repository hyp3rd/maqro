import { describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import {
  authenticatedWithPasskey,
  hasVerifiedFactor,
  sessionProvedSecondFactor,
} from "./mfa-policy";

function factors(
  ...entries: Array<{ type: string; status: "verified" | "unverified" }>
): Pick<User, "factors"> {
  return {
    factors: entries.map((e, i) => ({
      id: `f-${i}`,
      factor_type: e.type,
      status: e.status,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    })) as User["factors"],
  };
}

describe("hasVerifiedFactor", () => {
  it("is false when the user has no factors (GoTrue omits the key)", () => {
    expect(hasVerifiedFactor({})).toBe(false);
    expect(hasVerifiedFactor({ factors: [] })).toBe(false);
  });

  it("ignores unverified factors", () => {
    expect(
      hasVerifiedFactor(factors({ type: "totp", status: "unverified" })),
    ).toBe(false);
  });

  it("counts a verified factor of ANY type, like the RLS helper does", () => {
    expect(
      hasVerifiedFactor(factors({ type: "totp", status: "verified" })),
    ).toBe(true);
    expect(
      hasVerifiedFactor(factors({ type: "phone", status: "verified" })),
    ).toBe(true);
  });
});

describe("authenticatedWithPasskey", () => {
  it("matches GoTrue's passkey method in both amr shapes", () => {
    expect(authenticatedWithPasskey([{ method: "passkey" }])).toBe(true);
    expect(authenticatedWithPasskey(["otp", "passkey"])).toBe(true);
  });

  it("rejects every other method, including similar names", () => {
    expect(authenticatedWithPasskey([{ method: "otp" }])).toBe(false);
    expect(authenticatedWithPasskey([{ method: "passkey-ish" }])).toBe(false);
    expect(authenticatedWithPasskey([{ method: null }, {}])).toBe(false);
    expect(authenticatedWithPasskey(null)).toBe(false);
  });
});

describe("sessionProvedSecondFactor", () => {
  it("accepts aal2", () => {
    expect(sessionProvedSecondFactor({ aal: "aal2", amr: [] })).toBe(true);
  });

  it("accepts an aal1 passkey session", () => {
    expect(
      sessionProvedSecondFactor({ aal: "aal1", amr: [{ method: "passkey" }] }),
    ).toBe(true);
  });

  it("rejects an aal1 first-factor session", () => {
    expect(
      sessionProvedSecondFactor({ aal: "aal1", amr: [{ method: "otp" }] }),
    ).toBe(false);
  });

  it("rejects a malformed amr claim", () => {
    expect(sessionProvedSecondFactor({ aal: "aal1", amr: "passkey" })).toBe(
      false,
    );
    expect(sessionProvedSecondFactor({})).toBe(false);
  });
});
