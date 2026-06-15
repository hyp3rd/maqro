import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertAal2,
  isMfaProtectedPath,
  requiresMfaUpgrade,
} from "./mfa-required";

/** Build a fake SupabaseClient whose `auth.mfa` exposes only the
 *  two methods our helper calls. The full type is enormous — we
 *  cast through `unknown` because the contract surface we need is
 *  tiny + stable. */
function fakeSupabase(opts: {
  aalLevel?: "aal1" | "aal2" | "unknown" | null;
  nextLevel?: "aal1" | "aal2" | "unknown" | null;
  totp?: Array<{ status: "verified" | "unverified" }>;
  /** The session's authentication methods (JWT `amr`). */
  amr?: Array<{ method: string }>;
  aalThrows?: boolean;
  factorsThrows?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): SupabaseClient<any, any, any> {
  const mfa = {
    async getAuthenticatorAssuranceLevel() {
      if (opts.aalThrows) throw new Error("AAL failed");
      return {
        data:
          opts.aalLevel === null
            ? null
            : {
                currentLevel: opts.aalLevel ?? "aal1",
                nextLevel: opts.nextLevel ?? "aal1",
                currentAuthenticationMethods: opts.amr ?? [],
              },
        error: null,
      };
    },
    async listFactors() {
      if (opts.factorsThrows) throw new Error("listFactors failed");
      return { data: { totp: opts.totp ?? [], all: [] }, error: null };
    },
  };
  return {
    auth: { mfa },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as SupabaseClient<any, any, any>;
}

describe("requiresMfaUpgrade", () => {
  it("returns false when AAL is already aal2 (MFA done)", async () => {
    const supabase = fakeSupabase({ aalLevel: "aal2", nextLevel: "aal2" });
    await expect(requiresMfaUpgrade(supabase)).resolves.toEqual({
      needsUpgrade: false,
    });
  });

  it("returns false at aal1 when no TOTP is enrolled", async () => {
    const supabase = fakeSupabase({
      aalLevel: "aal1",
      // nextLevel defaults to aal1 when no factors are enrolled
      nextLevel: "aal1",
      totp: [],
    });
    await expect(requiresMfaUpgrade(supabase)).resolves.toEqual({
      needsUpgrade: false,
    });
  });

  it("returns false at aal1 when only an UNVERIFIED TOTP is enrolled", async () => {
    // A factor mid-enrollment shouldn't gate access — the user
    // is in the middle of setting it up; they haven't committed
    // to MFA yet.
    const supabase = fakeSupabase({
      aalLevel: "aal1",
      nextLevel: "aal2",
      totp: [{ status: "unverified" }],
    });
    await expect(requiresMfaUpgrade(supabase)).resolves.toEqual({
      needsUpgrade: false,
    });
  });

  it("returns true at aal1 with verified TOTP and aal2 available", async () => {
    const supabase = fakeSupabase({
      aalLevel: "aal1",
      nextLevel: "aal2",
      totp: [{ status: "verified" }],
    });
    await expect(requiresMfaUpgrade(supabase)).resolves.toEqual({
      needsUpgrade: true,
      reason: "aal1-with-totp",
    });
  });

  it("does NOT demand TOTP when the session was authenticated with a passkey (even with TOTP enrolled)", async () => {
    // A passkey sign-in is AAL1 in Supabase but satisfies our MFA bar. Without
    // the amr check this same input would return needsUpgrade:true (see the
    // test above) and bounce a passkey user to the TOTP prompt.
    const supabase = fakeSupabase({
      aalLevel: "aal1",
      nextLevel: "aal2",
      totp: [{ status: "verified" }],
      amr: [{ method: "webauthn" }],
    });
    await expect(requiresMfaUpgrade(supabase)).resolves.toEqual({
      needsUpgrade: false,
    });
  });

  it("recognizes the passkey method regardless of the exact amr string / casing", async () => {
    const supabase = fakeSupabase({
      aalLevel: "aal1",
      nextLevel: "aal2",
      totp: [{ status: "verified" }],
      amr: [{ method: "otp" }, { method: "Passkey" }],
    });
    await expect(requiresMfaUpgrade(supabase)).resolves.toEqual({
      needsUpgrade: false,
    });
  });

  it("returns false on AAL endpoint failure (lenient — don't lock non-MFA users out)", async () => {
    const supabase = fakeSupabase({ aalThrows: true });
    await expect(requiresMfaUpgrade(supabase)).resolves.toEqual({
      needsUpgrade: false,
    });
  });

  it("returns false on listFactors failure even at aal1 (lenient)", async () => {
    const supabase = fakeSupabase({
      aalLevel: "aal1",
      nextLevel: "aal2",
      factorsThrows: true,
    });
    await expect(requiresMfaUpgrade(supabase)).resolves.toEqual({
      needsUpgrade: false,
    });
  });

  it("returns false when AAL response has no data", async () => {
    const supabase = fakeSupabase({ aalLevel: null });
    await expect(requiresMfaUpgrade(supabase)).resolves.toEqual({
      needsUpgrade: false,
    });
  });

  describe("with isTrustedDevice predicate", () => {
    it("bypasses the upgrade when isTrustedDevice resolves true", async () => {
      // This is the "trust this device for 7 days" path — AAL1 +
      // verified TOTP would normally redirect, but a valid trust
      // grant short-circuits.
      const supabase = fakeSupabase({
        aalLevel: "aal1",
        nextLevel: "aal2",
        totp: [{ status: "verified" }],
      });
      const isTrustedDevice = vi.fn().mockResolvedValue(true);
      await expect(
        requiresMfaUpgrade(supabase, { isTrustedDevice }),
      ).resolves.toEqual({ needsUpgrade: false });
      expect(isTrustedDevice).toHaveBeenCalledOnce();
    });

    it("still demands upgrade when isTrustedDevice resolves false", async () => {
      const supabase = fakeSupabase({
        aalLevel: "aal1",
        nextLevel: "aal2",
        totp: [{ status: "verified" }],
      });
      const isTrustedDevice = vi.fn().mockResolvedValue(false);
      await expect(
        requiresMfaUpgrade(supabase, { isTrustedDevice }),
      ).resolves.toEqual({ needsUpgrade: true, reason: "aal1-with-totp" });
    });

    it("falls back to needsUpgrade when isTrustedDevice throws (strict)", async () => {
      // A throw from the trust check is treated as "no trust" — same
      // policy as `isCurrentDeviceTrusted` already enforces internally.
      const supabase = fakeSupabase({
        aalLevel: "aal1",
        nextLevel: "aal2",
        totp: [{ status: "verified" }],
      });
      const isTrustedDevice = vi.fn().mockRejectedValue(new Error("kaboom"));
      await expect(
        requiresMfaUpgrade(supabase, { isTrustedDevice }),
      ).resolves.toEqual({ needsUpgrade: true, reason: "aal1-with-totp" });
    });

    it("does not call isTrustedDevice on non-MFA users (cheap fast path)", async () => {
      // Non-MFA users never reach the AAL1+verified-TOTP branch where
      // the predicate fires. Verifying this keeps the DB lookup off
      // the hot path for the vast majority of users.
      const supabase = fakeSupabase({
        aalLevel: "aal1",
        nextLevel: "aal1",
        totp: [],
      });
      const isTrustedDevice = vi.fn().mockResolvedValue(true);
      await requiresMfaUpgrade(supabase, { isTrustedDevice });
      expect(isTrustedDevice).not.toHaveBeenCalled();
    });
  });
});

describe("isMfaProtectedPath", () => {
  it("protects the app shell", () => {
    expect(isMfaProtectedPath("/app")).toBe(true);
    expect(isMfaProtectedPath("/app?view=settings")).toBe(true);
    expect(isMfaProtectedPath("/app/")).toBe(true);
  });

  it("protects the admin pages", () => {
    expect(isMfaProtectedPath("/admin")).toBe(true);
    expect(isMfaProtectedPath("/admin/users")).toBe(true);
    expect(isMfaProtectedPath("/admin/webhooks")).toBe(true);
  });

  it("does NOT protect public marketing pages", () => {
    expect(isMfaProtectedPath("/")).toBe(false);
    expect(isMfaProtectedPath("/about")).toBe(false);
    expect(isMfaProtectedPath("/pricing")).toBe(false);
    expect(isMfaProtectedPath("/terms")).toBe(false);
    expect(isMfaProtectedPath("/privacy")).toBe(false);
    expect(isMfaProtectedPath("/contact")).toBe(false);
    expect(isMfaProtectedPath("/status")).toBe(false);
  });

  it("does NOT protect login (would loop) or API routes", () => {
    expect(isMfaProtectedPath("/login")).toBe(false);
    expect(isMfaProtectedPath("/login/recovery")).toBe(false);
    expect(isMfaProtectedPath("/api/health")).toBe(false);
    expect(isMfaProtectedPath("/api/admin/users")).toBe(false);
  });

  it("does NOT protect public share / unfurl pages", () => {
    expect(isMfaProtectedPath("/r/some-recipe")).toBe(false);
    expect(isMfaProtectedPath("/share/today")).toBe(false);
    expect(isMfaProtectedPath("/t/import")).toBe(false);
  });
});

describe("assertAal2", () => {
  it("returns ok when upgrade is not needed (no MFA enrolled)", async () => {
    const supabase = fakeSupabase({
      aalLevel: "aal1",
      nextLevel: "aal1",
      totp: [],
    });
    const result = await assertAal2(supabase);
    expect(result.ok).toBe(true);
  });

  it("returns ok when session is already at aal2", async () => {
    const supabase = fakeSupabase({ aalLevel: "aal2", nextLevel: "aal2" });
    const result = await assertAal2(supabase);
    expect(result.ok).toBe(true);
  });

  it("returns a 403 response with mfa-required kind when upgrade is needed", async () => {
    const supabase = fakeSupabase({
      aalLevel: "aal1",
      nextLevel: "aal2",
      totp: [{ status: "verified" }],
    });
    const result = await assertAal2(supabase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    const body = (await result.response.json()) as {
      error: string;
      kind: string;
    };
    // `kind` is the machine-stable signal clients key on to open the
    // two-step prompt (vs. show "not allowed" for a role failure); pin THAT,
    // not the user-facing copy, which is intentionally plain language.
    expect(body.kind).toBe("mfa-required");
    // The copy should point at the authenticator, never leak the "MFA" acronym.
    expect(body.error.toLowerCase()).toMatch(/authenticator/);
    expect(body.error).not.toMatch(/\bMFA\b/);
  });

  it("uses the lenient path on Supabase outage (treats errors as no-upgrade)", async () => {
    // Inherits `requiresMfaUpgrade`'s lenient behaviour. A
    // Supabase outage on the AAL endpoint shouldn't accidentally
    // block every authenticated user — better to let a single
    // request through than lock the whole user base out.
    const supabase = fakeSupabase({ aalThrows: true });
    const result = await assertAal2(supabase);
    expect(result.ok).toBe(true);
  });
});
