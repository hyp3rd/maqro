import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertAal2,
  assertFreshAal2,
  isMfaProtectedPath,
  type MfaGateUser,
  requiresMfaUpgrade,
} from "./mfa-required";

const USER_ID = "a0000000-0000-4000-8000-000000000001";

/** The user `auth.getUser()` returned — the server-verified source of truth
 *  for enrollment. */
function verifiedUser(
  factors: Array<"verified" | "unverified"> = [],
): MfaGateUser {
  return {
    id: USER_ID,
    factors: factors.map((status, i) => ({
      id: `factor-${i}`,
      factor_type: "totp",
      status,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    })) as MfaGateUser["factors"],
  };
}

/** A fake client exposing the VERIFIED claims path (`getClaims`) plus the
 *  cookie-derived paths the gate must NOT consult (`getSession`,
 *  `mfa.getAuthenticatorAssuranceLevel`, `mfa.listFactors`). The latter are
 *  spies seeded with a "no MFA" story so any accidental use flips a test. */
function fakeSupabase(
  opts: {
    aal?: string;
    amr?: unknown;
    sub?: string;
    claimsError?: boolean;
    claimsThrows?: boolean;
  } = {},
) {
  const getClaims = vi.fn(async () => {
    if (opts.claimsThrows) throw new Error("jwks fetch failed");
    if (opts.claimsError) {
      return { data: null, error: new Error("invalid JWT") };
    }
    return {
      data: {
        claims: {
          sub: opts.sub ?? USER_ID,
          aal: opts.aal ?? "aal1",
          amr: opts.amr ?? [{ method: "otp", timestamp: 1 }],
        },
      },
      error: null,
    };
  });
  // What a tampered / stale auth cookie says: no factors, nothing owed.
  const getSession = vi.fn(async () => ({
    data: { session: { user: { id: USER_ID, factors: [] } } },
    error: null,
  }));
  const getAuthenticatorAssuranceLevel = vi.fn(async () => ({
    data: { currentLevel: "aal1", nextLevel: "aal1" },
    error: null,
  }));
  const listFactors = vi.fn(async () => ({
    data: { totp: [], all: [] },
    error: null,
  }));
  const client = {
    auth: {
      getClaims,
      getSession,
      mfa: { getAuthenticatorAssuranceLevel, listFactors },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as SupabaseClient<any, any, any>;
  return {
    client,
    getClaims,
    cookieReaders: [getSession, getAuthenticatorAssuranceLevel],
  };
}

describe("requiresMfaUpgrade", () => {
  it("passes a user with no factors without verifying claims", async () => {
    const { client, getClaims } = fakeSupabase();
    await expect(requiresMfaUpgrade(client, verifiedUser())).resolves.toEqual({
      needsUpgrade: false,
    });
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("passes a user whose only factor is UNVERIFIED (mid-enrollment)", async () => {
    const { client } = fakeSupabase();
    await expect(
      requiresMfaUpgrade(client, verifiedUser(["unverified"])),
    ).resolves.toEqual({ needsUpgrade: false });
  });

  it("passes an enrolled user whose verified claims are aal2", async () => {
    const { client } = fakeSupabase({ aal: "aal2" });
    await expect(
      requiresMfaUpgrade(client, verifiedUser(["verified"])),
    ).resolves.toEqual({ needsUpgrade: false });
  });

  it("demands the second factor from an enrolled user at aal1", async () => {
    const { client } = fakeSupabase({ aal: "aal1" });
    await expect(
      requiresMfaUpgrade(client, verifiedUser(["verified"])),
    ).resolves.toEqual({ needsUpgrade: true, reason: "second-factor-pending" });
  });

  it("decides enrollment from the server-verified user, not the auth cookie", async () => {
    // The cookie session (tampered, or stale from before enrollment) lists no
    // factors and reports nextLevel aal1. The user GoTrue returned has a
    // verified TOTP factor. The gate must follow the server — and never even
    // read the cookie copy.
    const { client, cookieReaders } = fakeSupabase({ aal: "aal1" });
    await expect(
      requiresMfaUpgrade(client, verifiedUser(["verified"])),
    ).resolves.toEqual({ needsUpgrade: true, reason: "second-factor-pending" });
    for (const reader of cookieReaders) expect(reader).not.toHaveBeenCalled();
  });

  it("accepts a passkey sign-in (aal1 + amr passkey) for an enrolled user", async () => {
    const { client } = fakeSupabase({
      aal: "aal1",
      amr: [{ method: "passkey", timestamp: 1 }],
    });
    await expect(
      requiresMfaUpgrade(client, verifiedUser(["verified"])),
    ).resolves.toEqual({ needsUpgrade: false });
  });

  it("does not treat other amr methods as a passkey", async () => {
    const { client } = fakeSupabase({
      aal: "aal1",
      amr: [{ method: "oauth" }, "magiclink", { method: "webauthn-ish" }],
    });
    await expect(
      requiresMfaUpgrade(client, verifiedUser(["verified"])),
    ).resolves.toMatchObject({ needsUpgrade: true });
  });

  it("fails closed when the claims can't be verified", async () => {
    const { client } = fakeSupabase({ claimsError: true });
    await expect(
      requiresMfaUpgrade(client, verifiedUser(["verified"])),
    ).resolves.toEqual({
      needsUpgrade: true,
      reason: "assurance-unverifiable",
    });
  });

  it("fails closed when claim verification throws", async () => {
    const { client } = fakeSupabase({ claimsThrows: true });
    await expect(
      requiresMfaUpgrade(client, verifiedUser(["verified"])),
    ).resolves.toEqual({
      needsUpgrade: true,
      reason: "assurance-unverifiable",
    });
  });

  it("fails closed when the verified claims belong to another subject", async () => {
    const { client } = fakeSupabase({
      aal: "aal2",
      sub: "a0000000-0000-4000-8000-000000000999",
    });
    await expect(
      requiresMfaUpgrade(client, verifiedUser(["verified"])),
    ).resolves.toEqual({
      needsUpgrade: true,
      reason: "assurance-unverifiable",
    });
  });

  describe("with isTrustedDevice predicate", () => {
    it("bypasses the upgrade when isTrustedDevice resolves true", async () => {
      const { client } = fakeSupabase({ aal: "aal1" });
      const isTrustedDevice = vi.fn().mockResolvedValue(true);
      await expect(
        requiresMfaUpgrade(client, verifiedUser(["verified"]), {
          isTrustedDevice,
        }),
      ).resolves.toEqual({ needsUpgrade: false });
      expect(isTrustedDevice).toHaveBeenCalledOnce();
    });

    it("still demands upgrade when isTrustedDevice resolves false", async () => {
      const { client } = fakeSupabase({ aal: "aal1" });
      const isTrustedDevice = vi.fn().mockResolvedValue(false);
      await expect(
        requiresMfaUpgrade(client, verifiedUser(["verified"]), {
          isTrustedDevice,
        }),
      ).resolves.toEqual({
        needsUpgrade: true,
        reason: "second-factor-pending",
      });
    });

    it("falls back to needsUpgrade when isTrustedDevice throws (strict)", async () => {
      const { client } = fakeSupabase({ aal: "aal1" });
      const isTrustedDevice = vi.fn().mockRejectedValue(new Error("kaboom"));
      await expect(
        requiresMfaUpgrade(client, verifiedUser(["verified"]), {
          isTrustedDevice,
        }),
      ).resolves.toEqual({
        needsUpgrade: true,
        reason: "second-factor-pending",
      });
    });

    it("does not call isTrustedDevice on non-MFA users (cheap fast path)", async () => {
      const { client } = fakeSupabase({ aal: "aal1" });
      const isTrustedDevice = vi.fn().mockResolvedValue(true);
      await requiresMfaUpgrade(client, verifiedUser(), { isTrustedDevice });
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
  it("returns ok when no MFA is enrolled", async () => {
    const { client } = fakeSupabase();
    const result = await assertAal2(client, verifiedUser());
    expect(result.ok).toBe(true);
  });

  it("returns ok when the session is already at aal2", async () => {
    const { client } = fakeSupabase({ aal: "aal2" });
    const result = await assertAal2(client, verifiedUser(["verified"]));
    expect(result.ok).toBe(true);
  });

  it("returns a 403 response with mfa-required kind when upgrade is needed", async () => {
    const { client } = fakeSupabase({ aal: "aal1" });
    const result = await assertAal2(client, verifiedUser(["verified"]));
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

  it("fails closed for an enrolled user when claims can't be verified", async () => {
    const { client } = fakeSupabase({ claimsError: true });
    const result = await assertAal2(client, verifiedUser(["verified"]));
    expect(result.ok).toBe(false);
  });
});

describe("assertFreshAal2", () => {
  it("rejects the cookie-tampering case: aal1 session, server says enrolled", async () => {
    const { client, cookieReaders } = fakeSupabase({ aal: "aal1" });
    const result = await assertFreshAal2(client, verifiedUser(["verified"]));
    expect(result.ok).toBe(false);
    for (const reader of cookieReaders) expect(reader).not.toHaveBeenCalled();
  });

  it("allows an aal2 session", async () => {
    const { client } = fakeSupabase({ aal: "aal2" });
    const result = await assertFreshAal2(client, verifiedUser(["verified"]));
    expect(result.ok).toBe(true);
  });
});
