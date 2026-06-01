/**
 * @vitest-environment jsdom
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/** The banner consumes `useSubscriptionStatus` and reads
 *  `sessionStorage`. Mock the hook directly so each test controls
 *  the rendered state in one place. */
const mockUseSubscriptionStatus = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-subscription-status", () => ({
  useSubscriptionStatus: mockUseSubscriptionStatus,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const DISMISS_KEY = "maqro:past-due-banner:dismissed:v1";

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("PastDueBanner", () => {
  it("renders nothing when status is loading", async () => {
    mockUseSubscriptionStatus.mockReturnValue({ kind: "loading" });
    const { PastDueBanner } = await import("./PastDueBanner");
    const { container } = render(<PastDueBanner />);
    expect(container.textContent).not.toContain("Payment failed");
  });

  it("renders nothing for an active subscription", async () => {
    mockUseSubscriptionStatus.mockReturnValue({
      kind: "known",
      status: "active",
    });
    const { PastDueBanner } = await import("./PastDueBanner");
    render(<PastDueBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders the dunning banner only on past_due", async () => {
    mockUseSubscriptionStatus.mockReturnValue({
      kind: "known",
      status: "past_due",
    });
    const { PastDueBanner } = await import("./PastDueBanner");
    render(<PastDueBanner />);
    // jest-dom matchers aren't auto-imported; use the plain RTL
    // queries that throw on miss (`getBy…`) as the existence
    // assertion, then re-check via `queryBy…` for not-null.
    expect(screen.queryByRole("alert")).not.toBeNull();
    expect(screen.queryByText(/Payment failed/i)).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: /update payment/i }),
    ).not.toBeNull();
  });

  it("respects a prior session dismissal stored in sessionStorage", async () => {
    window.sessionStorage.setItem(DISMISS_KEY, "1");
    mockUseSubscriptionStatus.mockReturnValue({
      kind: "known",
      status: "past_due",
    });
    const { PastDueBanner } = await import("./PastDueBanner");
    render(<PastDueBanner />);
    // After the initial useEffect runs, the dismissed flag should
    // hide the banner.
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("does not render for unknown future Stripe statuses", async () => {
    mockUseSubscriptionStatus.mockReturnValue({
      kind: "unknown",
      raw: "paused",
    });
    const { PastDueBanner } = await import("./PastDueBanner");
    render(<PastDueBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
