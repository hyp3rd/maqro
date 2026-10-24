/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonalInfo } from "@maqro/core/types";
import type { User } from "@supabase/supabase-js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/** Profile → My docs while offline-unverified (an expired session opened
 *  without reaching the auth server): the account is still on this device,
 *  so the page must not ask to sign in; it explains, as Billing does, why
 *  the documents can't load. */

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
// The cloud list needs a session; only whether it is shown matters here.
vi.mock("./SavedReportsList", () => ({
  SavedReportsList: () => <p>saved reports</p>,
}));

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

function openDocs() {
  render(
    <ProfileView
      personalInfo={PROFILE}
      onPersonalInfoChange={() => {}}
      today="2026-06-10"
      planWeek={() => null}
      onTrainingChange={() => {}}
      onProteinSettingChange={() => {}}
    />,
  );
  fireEvent.click(screen.getByText("My docs"));
}

afterEach(() => {
  cleanup();
});

describe("Profile docs", () => {
  it("offline-unverified: explains the server can't be reached, no Sign in", () => {
    auth.state = {
      user: null,
      localUserId: "u1",
      isOfflineUnverified: true,
      isLoaded: true,
      isUnconfigured: false,
    };
    openDocs();
    expect(screen.getByRole("status").textContent).toBe(
      "Can't reach the account server — your data stays on this device. Your documents load once it can be reached.",
    );
    expect(screen.queryByText(/sign in to save/i)).toBeNull();
    expect(screen.queryByText("saved reports")).toBeNull();
  });

  it("signed out: asks to sign in", () => {
    auth.state = {
      user: null,
      localUserId: null,
      isOfflineUnverified: false,
      isLoaded: true,
      isUnconfigured: false,
    };
    openDocs();
    expect(screen.getByText(/sign in to save/i)).toBeTruthy();
  });

  it("signed in: lists the saved documents", () => {
    auth.state = {
      user: { id: "u1" } as User,
      localUserId: "u1",
      isOfflineUnverified: false,
      isLoaded: true,
      isUnconfigured: false,
    };
    openDocs();
    expect(screen.getByText("saved reports")).toBeTruthy();
  });
});
