import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getVerifiedTotpFactorId } from "./mfa-factors";

type Factor = { id: string; status: "verified" | "unverified" };

function fakeSupabase(opts: {
  totp?: Factor[];
  data?: null;
  throws?: boolean;
}): SupabaseClient {
  return {
    auth: {
      mfa: {
        listFactors: vi.fn(async () => {
          if (opts.throws) throw new Error("network down");
          if (opts.data === null) return { data: null, error: null };
          return {
            data: { totp: opts.totp ?? [], all: opts.totp ?? [] },
            error: null,
          };
        }),
      },
    },
  } as unknown as SupabaseClient;
}

describe("getVerifiedTotpFactorId", () => {
  it("returns the id of the verified TOTP factor", async () => {
    const supabase = fakeSupabase({
      totp: [
        { id: "unverified-1", status: "unverified" },
        { id: "verified-1", status: "verified" },
      ],
    });
    expect(await getVerifiedTotpFactorId(supabase)).toBe("verified-1");
  });

  it("returns null when no factor is verified", async () => {
    const supabase = fakeSupabase({
      totp: [{ id: "u", status: "unverified" }],
    });
    expect(await getVerifiedTotpFactorId(supabase)).toBeNull();
  });

  it("returns null when there are no TOTP factors", async () => {
    expect(
      await getVerifiedTotpFactorId(fakeSupabase({ totp: [] })),
    ).toBeNull();
  });

  it("returns null when listFactors returns null data", async () => {
    expect(
      await getVerifiedTotpFactorId(fakeSupabase({ data: null })),
    ).toBeNull();
  });

  it("swallows a thrown error and returns null", async () => {
    expect(
      await getVerifiedTotpFactorId(fakeSupabase({ throws: true })),
    ).toBeNull();
  });
});
