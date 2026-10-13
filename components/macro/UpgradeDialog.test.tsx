/**
 * @vitest-environment jsdom
 */
import type { AiUsageState } from "@/hooks/use-ai-usage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

/** The upgrade dialog decides where an upgrade goes: Stripe Checkout for a
 *  new subscriber, the plan-change flow for an existing one (never a second
 *  subscription). */

const mockClientFetch = vi.hoisted(() => vi.fn());
const mockUsage = vi.hoisted(() => ({
  state: { status: "loading" } as AiUsageState,
}));

vi.mock("@/lib/auth/client-fetch", () => ({ clientFetch: mockClientFetch }));
vi.mock("@/hooks/use-ai-usage", () => ({
  useAiUsage: () => ({ state: mockUsage.state, refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { UpgradeDialog } = await import("./UpgradeDialog");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function usage(subscriptionStatus: string | null): AiUsageState {
  return {
    status: "ok",
    data: {
      used: 0,
      cap: subscriptionStatus ? 500 : 25,
      tier: subscriptionStatus ? "plus" : "free",
      isPremium: subscriptionStatus !== null,
      subscriptionStatus,
      currentPeriodEnd: null,
    },
  };
}

const assign = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("location", { ...window.location, assign });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderDialog() {
  render(
    <UpgradeDialog
      open
      onOpenChange={() => {}}
      defaultPlan="pro"
    />,
  );
}

describe("UpgradeDialog", () => {
  it("sends a free user to Checkout", async () => {
    mockUsage.state = usage(null);
    mockClientFetch.mockResolvedValue(
      jsonResponse(200, { url: "https://checkout.stripe.test/s" }),
    );
    renderDialog();

    expect(screen.getByText(/7-day free trial/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Continue with Pro/ }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/s"),
    );
    expect(mockClientFetch).toHaveBeenCalledTimes(1);
    expect(mockClientFetch.mock.calls[0]?.[0]).toBe("/api/billing/checkout");
  });

  it("sends an AI Plus subscriber's Upgrade to Pro to the plan change, not Checkout", async () => {
    mockUsage.state = usage("active");
    mockClientFetch.mockResolvedValue(
      jsonResponse(200, { url: "https://billing.stripe.test/p" }),
    );
    renderDialog();

    expect(screen.queryByText(/7-day free trial/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Switch to Pro/ }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://billing.stripe.test/p"),
    );
    expect(mockClientFetch).toHaveBeenCalledTimes(1);
    expect(mockClientFetch.mock.calls[0]?.[0]).toBe("/api/billing/change-plan");
    expect(JSON.parse(mockClientFetch.mock.calls[0]?.[1].body)).toEqual({
      interval: "month",
      plan: "pro",
    });
  });

  it("falls back to the plan change when Checkout reports an existing subscription", async () => {
    // Usage hasn't caught up with a subscription that just started.
    mockUsage.state = usage(null);
    mockClientFetch
      .mockResolvedValueOnce(
        jsonResponse(409, {
          error: "You already have a subscription.",
          code: "subscription_exists",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { url: "https://billing.stripe.test/p" }),
      );
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /Continue with Pro/ }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://billing.stripe.test/p"),
    );
    expect(mockClientFetch.mock.calls.map((c) => c[0])).toEqual([
      "/api/billing/checkout",
      "/api/billing/change-plan",
    ]);
  });

  it("surfaces the server's error and does not redirect", async () => {
    const { toast } = await import("sonner");
    mockUsage.state = usage("active");
    mockClientFetch.mockResolvedValue(
      jsonResponse(409, { error: "You're already on this plan." }),
    );
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /Switch to Pro/ }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("You're already on this plan."),
    );
    expect(assign).not.toHaveBeenCalled();
  });
});
