import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertDataApiAssurance, MfaRequiredError } from "./session-assurance";

function fakeSupabase(opts: {
  aal?: string;
  amr?: unknown[];
  serverFactors?: Array<"verified" | "unverified">;
  userError?: Error;
}) {
  const getAuthenticatorAssuranceLevel = vi.fn(async () => ({
    data: {
      currentLevel: opts.aal ?? "aal1",
      // The local session's view — deliberately "nothing enrolled" so the
      // tests prove the decision follows the server's factor list.
      nextLevel: opts.aal ?? "aal1",
      currentAuthenticationMethods: opts.amr ?? [{ method: "otp" }],
    },
    error: null,
  }));
  const getUser = vi.fn(async () =>
    opts.userError
      ? { data: { user: null }, error: opts.userError }
      : {
          data: {
            user: {
              id: "u1",
              factors: (opts.serverFactors ?? []).map((status) => ({
                id: "f",
                factor_type: "totp",
                status,
              })),
            },
          },
          error: null,
        },
  );
  const client = {
    auth: { getUser, mfa: { getAuthenticatorAssuranceLevel } },
  } as unknown as SupabaseClient;
  return { client, getUser };
}

describe("assertDataApiAssurance", () => {
  it("passes an aal2 session without a network round-trip", async () => {
    const { client, getUser } = fakeSupabase({ aal: "aal2" });
    await expect(assertDataApiAssurance(client)).resolves.toBeUndefined();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("passes a passkey session without a network round-trip", async () => {
    const { client, getUser } = fakeSupabase({
      aal: "aal1",
      amr: [{ method: "passkey" }],
    });
    await expect(assertDataApiAssurance(client)).resolves.toBeUndefined();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("passes an aal1 session when the server lists no verified factor", async () => {
    const { client } = fakeSupabase({ serverFactors: ["unverified"] });
    await expect(assertDataApiAssurance(client)).resolves.toBeUndefined();
  });

  it("rejects with MfaRequiredError when the server lists a verified factor", async () => {
    // e.g. the user enrolled TOTP on another device after this token was
    // minted: the local session still says nothing is enrolled.
    const { client } = fakeSupabase({ serverFactors: ["verified"] });
    await expect(assertDataApiAssurance(client)).rejects.toBeInstanceOf(
      MfaRequiredError,
    );
  });

  it("fails closed when the factor list can't be fetched", async () => {
    const { client } = fakeSupabase({ userError: new Error("offline") });
    await expect(assertDataApiAssurance(client)).rejects.toThrow("offline");
  });
});
