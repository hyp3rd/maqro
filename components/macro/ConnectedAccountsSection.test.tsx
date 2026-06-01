/**
 * @vitest-environment jsdom
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

/** Scope queries to a single provider's row. With both Google and
 *  Apple rendered, an unscoped `queryByRole("button", {name: /connect/})`
 *  finds two — every provider-specific assertion targets its own
 *  `<li>` (located by the provider label) via `within`. */
function providerRow(label: string): HTMLElement {
  const li = screen.getByText(label).closest("li");
  if (!li) throw new Error(`No row for provider "${label}"`);
  return li as HTMLElement;
}

const mockGetUserIdentities = vi.hoisted(() => vi.fn());
const mockLinkIdentity = vi.hoisted(() => vi.fn());
const mockUnlinkIdentity = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => ({
    auth: {
      getUserIdentities: mockGetUserIdentities,
      linkIdentity: mockLinkIdentity,
      unlinkIdentity: mockUnlinkIdentity,
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

describe("ConnectedAccountsSection — render branches", () => {
  it("renders nothing when not signed in", async () => {
    mockGetUserIdentities.mockResolvedValue({
      data: { identities: [] },
      error: null,
    });
    const { ConnectedAccountsSection } =
      await import("./ConnectedAccountsSection");
    const { container } = render(<ConnectedAccountsSection signedIn={false} />);
    expect(container.textContent).toBe("");
  });

  it("shows a Connect button when Google isn't linked", async () => {
    // Email-only user — one identity (email), no Google. The
    // Connect button is offered.
    mockGetUserIdentities.mockResolvedValue({
      data: {
        identities: [{ id: "email-1", provider: "email", identity_data: {} }],
      },
      error: null,
    });
    const { ConnectedAccountsSection } =
      await import("./ConnectedAccountsSection");
    render(<ConnectedAccountsSection signedIn={true} />);
    await waitFor(() => {
      expect(
        within(providerRow("Google")).queryByRole("button", {
          name: /^connect$/i,
        }),
      ).not.toBeNull();
    });
    expect(
      within(providerRow("Google")).queryByText(/Not connected/i),
    ).not.toBeNull();
  });

  it("renders Disconnect when Google is linked AND another identity exists", async () => {
    mockGetUserIdentities.mockResolvedValue({
      data: {
        identities: [
          { id: "email-1", provider: "email", identity_data: {} },
          {
            id: "google-1",
            provider: "google",
            identity_data: { email: "alice@gmail.com" },
          },
        ],
      },
      error: null,
    });
    const { ConnectedAccountsSection } =
      await import("./ConnectedAccountsSection");
    render(<ConnectedAccountsSection signedIn={true} />);
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /^disconnect$/i }),
      ).not.toBeNull();
    });
    expect(screen.queryByText(/alice@gmail.com/)).not.toBeNull();
  });

  it("hides Disconnect when Google is the user's only identity (lockout protection)", async () => {
    // User signed up via Google only. Unlinking would leave them
    // with zero identities → permanent lockout. UI must not offer
    // the option. The "Sole sign-in" pill stands in for the
    // missing affordance.
    mockGetUserIdentities.mockResolvedValue({
      data: {
        identities: [
          {
            id: "google-1",
            provider: "google",
            identity_data: { email: "alice@gmail.com" },
          },
        ],
      },
      error: null,
    });
    const { ConnectedAccountsSection } =
      await import("./ConnectedAccountsSection");
    render(<ConnectedAccountsSection signedIn={true} />);
    await waitFor(() => {
      expect(screen.queryByText(/Sole sign-in/i)).not.toBeNull();
    });
    expect(screen.queryByRole("button", { name: /^disconnect$/i })).toBeNull();
  });

  it("calls linkIdentity({ provider: 'google' }) on Connect click", async () => {
    mockGetUserIdentities.mockResolvedValue({
      data: {
        identities: [{ id: "email-1", provider: "email", identity_data: {} }],
      },
      error: null,
    });
    mockLinkIdentity.mockResolvedValue({
      data: { url: "https://…" },
      error: null,
    });
    const { ConnectedAccountsSection } =
      await import("./ConnectedAccountsSection");
    render(<ConnectedAccountsSection signedIn={true} />);
    const connectBtn = await waitFor(() => {
      const b = within(providerRow("Google")).queryByRole("button", {
        name: /^connect$/i,
      });
      if (!b) throw new Error("button not ready");
      return b;
    });
    fireEvent.click(connectBtn);
    await waitFor(() => {
      expect(mockLinkIdentity).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "google" }),
      );
    });
  });

  it("renders an error branch when getUserIdentities fails", async () => {
    mockGetUserIdentities.mockResolvedValue({
      data: null,
      error: { message: "session expired" },
    });
    const { ConnectedAccountsSection } =
      await import("./ConnectedAccountsSection");
    render(<ConnectedAccountsSection signedIn={true} />);
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeNull();
    });
    expect(screen.queryByText(/session expired/i)).not.toBeNull();
  });
});
