/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/** The PasskeysSection UI is mostly Supabase-client plumbing. What's
 *  worth testing is the load-state → render-branch mapping
 *  (`loading` → `unsupported` / `unavailable` / `ready[empty]` /
 *  `ready[populated]` / `error`). The register / rename / delete
 *  ceremonies hit `navigator.credentials` which jsdom doesn't
 *  simulate; those are covered manually against a real deployment. */

const mockList = vi.hoisted(() => vi.fn());
const mockRegister = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => ({
    auth: {
      registerPasskey: mockRegister,
      passkey: { list: mockList, update: mockUpdate, delete: mockDelete },
    },
  }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/** WebAuthn-feature detection reads `window.PublicKeyCredential`.
 *  jsdom doesn't expose it, which gives us the realistic "unsupported"
 *  default. Tests that want the supported branch poke a stub onto
 *  the window via `installWebAuthn(true)`. */
function installWebAuthn(supported: boolean) {
  if (supported) {
    vi.stubGlobal("PublicKeyCredential", function MockPKC() {} as unknown);
  } else {
    vi.stubGlobal("PublicKeyCredential", undefined);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PasskeysSection - render branches", () => {
  it("renders nothing when not signed in", async () => {
    installWebAuthn(true);
    mockList.mockResolvedValue({ data: [], error: null });
    const { PasskeysSection } = await import("./PasskeysSection");
    const { container } = render(<PasskeysSection signedIn={false} />);
    expect(container.textContent).toBe("");
  });

  it("shows the unsupported-browser branch when WebAuthn is absent", async () => {
    installWebAuthn(false);
    mockList.mockResolvedValue({ data: [], error: null });
    const { PasskeysSection } = await import("./PasskeysSection");
    render(<PasskeysSection signedIn={true} />);
    await waitFor(() => expect(screen.queryByText(/WebAuthn/i)).not.toBeNull());
    // Should NOT have called list() — feature is unsupported, no
    // point round-tripping to Supabase.
    expect(mockList).not.toHaveBeenCalled();
  });

  it("shows the unavailable branch when the SDK reports the feature is disabled", async () => {
    installWebAuthn(true);
    mockList.mockResolvedValue({
      data: null,
      error: { message: "passkey_disabled: experimental flag not set" },
    });
    const { PasskeysSection } = await import("./PasskeysSection");
    render(<PasskeysSection signedIn={true} />);
    await waitFor(() =>
      expect(screen.queryByText(/aren't enabled/i)).not.toBeNull(),
    );
  });

  it("shows the empty state with an 'Add a passkey' button when the list is empty", async () => {
    installWebAuthn(true);
    mockList.mockResolvedValue({ data: [], error: null });
    const { PasskeysSection } = await import("./PasskeysSection");
    render(<PasskeysSection signedIn={true} />);
    await waitFor(() =>
      expect(screen.queryByText(/no passkeys yet/i)).not.toBeNull(),
    );
    expect(
      screen.queryByRole("button", { name: /add a passkey/i }),
    ).not.toBeNull();
  });

  it("renders each registered passkey with its friendly name", async () => {
    installWebAuthn(true);
    mockList.mockResolvedValue({
      data: [
        {
          id: "pk_1",
          friendly_name: "MacBook Touch ID",
          created_at: "2026-05-01T12:00:00Z",
        },
        {
          id: "pk_2",
          friendly_name: "YubiKey 5C",
          created_at: "2026-05-15T09:30:00Z",
          last_used_at: "2026-05-28T14:22:00Z",
        },
      ],
      error: null,
    });
    const { PasskeysSection } = await import("./PasskeysSection");
    render(<PasskeysSection signedIn={true} />);
    await waitFor(() =>
      expect(screen.queryByText("MacBook Touch ID")).not.toBeNull(),
    );
    expect(screen.queryByText("YubiKey 5C")).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: /add another passkey/i }),
    ).not.toBeNull();
  });

  it("falls back to 'Unnamed passkey' when friendly_name is missing or blank", async () => {
    installWebAuthn(true);
    mockList.mockResolvedValue({
      data: [{ id: "pk_3", created_at: "2026-05-01T00:00:00Z" }],
      error: null,
    });
    const { PasskeysSection } = await import("./PasskeysSection");
    render(<PasskeysSection signedIn={true} />);
    await waitFor(() =>
      expect(screen.queryByText(/unnamed passkey/i)).not.toBeNull(),
    );
  });

  it("shows the error branch when the SDK returns an unrecognized error", async () => {
    installWebAuthn(true);
    mockList.mockResolvedValue({
      data: null,
      error: { message: "Internal server error" },
    });
    const { PasskeysSection } = await import("./PasskeysSection");
    render(<PasskeysSection signedIn={true} />);
    await waitFor(() => {
      const alerts = screen.queryAllByRole("alert");
      // The error message lands inside the role="alert" region.
      expect(
        alerts.some((el) => el.textContent?.includes("Internal server error")),
      ).toBe(true);
    });
  });
});
