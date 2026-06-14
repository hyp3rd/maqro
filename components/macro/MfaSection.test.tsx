/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

/** The Settings MFA UI is mostly Supabase-client plumbing - the
 *  thing worth testing is the load-state → render-branch mapping
 *  (`loading` → `empty` / `enrolled` / `unavailable`). Enrollment
 *  itself (click → enroll → QR → verify) is integration-heavy and
 *  better covered manually against a real Supabase project. */

const mockListFactors = vi.hoisted(() => vi.fn());
const mockEnroll = vi.hoisted(() => vi.fn());
const mockUnenroll = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => ({
    auth: {
      mfa: {
        listFactors: mockListFactors,
        enroll: mockEnroll,
        unenroll: mockUnenroll,
      },
    },
  }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("MfaSection - render branches", () => {
  it("renders nothing when not signed in", async () => {
    mockListFactors.mockResolvedValue({
      data: { totp: [], all: [] },
      error: null,
    });
    const { MfaSection } = await import("./MfaSection");
    const { container } = render(<MfaSection signedIn={false} />);
    expect(container.textContent).toBe("");
  });

  it("shows the empty state when listFactors returns no TOTP factors", async () => {
    mockListFactors.mockResolvedValue({
      data: { totp: [], all: [] },
      error: null,
    });
    const { MfaSection } = await import("./MfaSection");
    render(<MfaSection signedIn={true} />);
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /set up authenticator app/i }),
      ).not.toBeNull();
    });
  });

  it("renders enrolled TOTP factors as a list with Remove buttons", async () => {
    const factor = {
      id: "factor-1",
      friendly_name: "iPhone Authenticator",
      status: "verified",
      factor_type: "totp",
      created_at: "2026-01-15T10:00:00Z",
    };
    mockListFactors.mockResolvedValue({
      // `mapFactors` iterates `data.totp` only - this section is
      // TOTP-scoped.
      data: { totp: [factor], all: [factor] },
      error: null,
    });
    const { MfaSection } = await import("./MfaSection");
    render(<MfaSection signedIn={true} />);
    await waitFor(() => {
      expect(screen.queryByText("iPhone Authenticator")).not.toBeNull();
    });
    expect(screen.queryAllByRole("button", { name: /^remove$/i }).length).toBe(
      1,
    );
  });

  it("filters out unverified factors from the enrolled list", async () => {
    // Abandoned enroll attempts leave unverified rows behind.
    // They shouldn't read as "you have 2FA set up" when they
    // don't actually protect anything.
    const orphan = {
      id: "factor-orphan",
      friendly_name: "Abandoned",
      status: "unverified",
      factor_type: "totp",
      created_at: "2026-01-15T10:00:00Z",
    };
    mockListFactors.mockResolvedValue({
      data: { totp: [orphan], all: [orphan] },
      error: null,
    });
    const { MfaSection } = await import("./MfaSection");
    render(<MfaSection signedIn={true} />);
    // Wait for load to settle, then check the verified list is empty.
    await waitFor(() => {
      // The header always renders once load resolves.
      expect(
        screen.getByRole("heading", { name: /two-step verification/i }),
      ).not.toBeNull();
    });
    expect(screen.queryByText("Abandoned")).toBeNull();
  });

  it("renders an 'error' state when listFactors itself errors", async () => {
    mockListFactors.mockResolvedValue({
      data: null,
      error: { message: "auth.users RLS denied" },
    });
    const { MfaSection } = await import("./MfaSection");
    render(<MfaSection signedIn={true} />);
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeNull();
    });
    expect(screen.queryByText(/RLS denied/i)).not.toBeNull();
  });
});

describe("MfaSection - naming step", () => {
  it("routes empty → naming → enroll with the user-typed name", async () => {
    // Start from empty, walk through the naming step, assert that
    // `enroll()` is called with the exact friendly name the user
    // typed (no auto-generated date fallback when they provided
    // a real value).
    mockListFactors.mockResolvedValue({
      data: { totp: [], all: [] },
      error: null,
    });
    mockEnroll.mockResolvedValue({
      data: {
        id: "factor-new",
        type: "totp",
        totp: {
          qr_code: "data:image/svg+xml;utf-8,<svg/>",
          secret: "JBSWY3DPEHPK3PXP",
          uri: "otpauth://…",
        },
        friendly_name: "Work laptop",
      },
      error: null,
    });

    const { MfaSection } = await import("./MfaSection");
    render(<MfaSection signedIn={true} />);

    // Wait for the empty state's button to be in the DOM.
    const setupBtn = await waitFor(() => {
      const btn = screen.queryByRole("button", {
        name: /set up authenticator app/i,
      });
      if (!btn) throw new Error("button not ready");
      return btn;
    });

    // Click → transitions to the naming step. The input should
    // appear with the autoFocus prop honored.
    fireEvent.click(setupBtn);
    const nameInput = await waitFor(() => {
      const el = screen.queryByLabelText(/name this authenticator/i);
      if (!el) throw new Error("input not ready");
      return el as HTMLInputElement;
    });

    fireEvent.change(nameInput, { target: { value: "Work laptop" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(mockEnroll).toHaveBeenCalledWith({
        factorType: "totp",
        friendlyName: "Work laptop",
      });
    });
  });

  it("cancel from naming drops back to the empty state without firing enroll", async () => {
    mockListFactors.mockResolvedValue({
      data: { totp: [], all: [] },
      error: null,
    });
    const { MfaSection } = await import("./MfaSection");
    render(<MfaSection signedIn={true} />);

    const setupBtn = await waitFor(() => {
      const btn = screen.queryByRole("button", {
        name: /set up authenticator app/i,
      });
      if (!btn) throw new Error("button not ready");
      return btn;
    });
    fireEvent.click(setupBtn);

    // We're now in `naming` - Cancel should bring back the empty
    // CTA without ever calling enroll().
    await waitFor(() => {
      expect(
        screen.queryByLabelText(/name this authenticator/i),
      ).not.toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /set up authenticator app/i }),
      ).not.toBeNull();
    });
    expect(mockEnroll).not.toHaveBeenCalled();
  });
});
