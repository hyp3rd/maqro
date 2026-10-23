/**
 * @vitest-environment jsdom
 */
import type { AiUsageState } from "@/hooks/use-ai-usage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersonalInfo } from "@maqro/core/types";
import type { User } from "@supabase/supabase-js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/** Profile → Billing & subscription while offline-unverified (an expired
 *  session opened without reaching the auth server): the account is still
 *  on this device, so the page must not ask to sign in, and the usage card
 *  must explain why its data can't load instead of offering a Refresh that
 *  cannot work (there is no session to fetch with). */

const auth = vi.hoisted(() => ({
  state: {
    user: null as User | null,
    localUserId: null as string | null,
    isOfflineUnverified: false,
    isLoaded: true,
    isUnconfigured: false,
  },
}));
vi.mock("@/hooks/use-user", () => ({ useUser: () => auth.state }));

const usage = vi.hoisted(() => ({
  state: null as AiUsageState | null,
  refresh: vi.fn(),
}));
vi.mock("@/hooks/use-ai-usage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-ai-usage")>();
  return {
    ...actual,
    useAiUsage: () => ({ state: usage.state, refresh: usage.refresh }),
  };
});

const { OFFLINE_UNVERIFIED_USAGE } = await import("@/hooks/use-ai-usage");
const { ProfileView } = await import("./ProfileView");

const PROFILE: PersonalInfo = {
  gender: "male",
  age: 30,
  weight: 80,
  height: 180,
  activityLevel: "moderate",
  goal: "maintain",
  dietType: "balanced",
  dietPreference: "omnivore",
  cuisinePreferences: [],
  allergies: [],
  dislikedFoods: [],
  weeklyRateKg: 0,
  units: "metric",
};

function openBilling() {
  render(
    <ProfileView
      personalInfo={PROFILE}
      onPersonalInfoChange={() => {}}
      today="2026-06-10"
    />,
  );
  fireEvent.click(screen.getByText("Billing & subscription"));
}

beforeEach(() => {
  usage.refresh.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Profile billing while offline-unverified", () => {
  beforeEach(() => {
    auth.state = {
      user: null,
      localUserId: "u1",
      isOfflineUnverified: true,
      isLoaded: true,
      isUnconfigured: false,
    };
    usage.state = OFFLINE_UNVERIFIED_USAGE;
  });

  it("explains why usage can't load, with no Refresh and no Sign in", () => {
    openBilling();
    expect(screen.getByRole("status").textContent).toBe(
      "Can't reach the account server — your data stays on this device. Usage loads once it can be reached.",
    );
    expect(screen.queryByRole("button", { name: /refresh/i })).toBeNull();
    expect(screen.queryByText(/sign in to view/i)).toBeNull();
  });
});

describe("Profile billing, controls", () => {
  it("signed in: the usage card offers Refresh", () => {
    auth.state = {
      user: { id: "u1" } as User,
      localUserId: "u1",
      isOfflineUnverified: false,
      isLoaded: true,
      isUnconfigured: false,
    };
    usage.state = { status: "loading" };
    openBilling();
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(usage.refresh).toHaveBeenCalledTimes(1);
  });

  it("signed in, usage failed for another reason: the card stays hidden", () => {
    auth.state = {
      user: { id: "u1" } as User,
      localUserId: "u1",
      isOfflineUnverified: false,
      isLoaded: true,
      isUnconfigured: false,
    };
    usage.state = { status: "error", message: "HTTP 500" };
    openBilling();
    expect(screen.queryByText("AI usage")).toBeNull();
  });

  it("signed out: asks to sign in", () => {
    auth.state = {
      user: null,
      localUserId: null,
      isOfflineUnverified: false,
      isLoaded: true,
      isUnconfigured: false,
    };
    usage.state = { status: "anon" };
    openBilling();
    expect(screen.getByText(/sign in to view your plan/i)).toBeTruthy();
  });
});
