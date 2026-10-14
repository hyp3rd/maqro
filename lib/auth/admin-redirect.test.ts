import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminRedirectGuard } from "./admin-redirect";

const USER_ID = "a0000000-0000-4000-8000-000000000001";

const { mockGetUser, mockGetClaims, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockGetClaims: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: vi.fn(async () => ({
    auth: { getUser: mockGetUser, getClaims: mockGetClaims },
    from: mockFrom,
  })),
}));

function signIn(opts: { enrolled: boolean; aal: "aal1" | "aal2" }) {
  mockGetUser.mockResolvedValue({
    data: {
      user: {
        id: USER_ID,
        factors: opts.enrolled
          ? [{ id: "f1", factor_type: "totp", status: "verified" }]
          : [],
      },
    },
  });
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: USER_ID, aal: opts.aal, amr: [] } },
    error: null,
  });
}

function profileRole(role: string) {
  mockFrom.mockReturnValue({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: { role } }) }),
    }),
  });
}

const request = new Request(
  "https://maqro.test/api/admin/social/linkedin/connect",
);

describe("adminRedirectGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileRole("admin");
  });

  it("sends an enrolled admin at AAL1 to the second-factor prompt", async () => {
    signIn({ enrolled: true, aal: "aal1" });
    const res = await adminRedirectGuard(request, "/admin/social");
    expect(res).not.toBeNull();
    const location = new URL(res?.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("mfa")).toBe("required");
    expect(location.searchParams.get("next")).toBe("/admin/social");
    // The role isn't even looked up before the second factor.
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("lets an AAL2 admin through", async () => {
    signIn({ enrolled: true, aal: "aal2" });
    await expect(adminRedirectGuard(request, "/admin/social")).resolves.toBe(
      null,
    );
  });

  it("still bounces a non-admin to /app", async () => {
    signIn({ enrolled: false, aal: "aal1" });
    profileRole("user");
    const res = await adminRedirectGuard(request, "/admin/social");
    expect(new URL(res?.headers.get("location") ?? "").pathname).toBe("/app");
  });
});
