/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonalInfo } from "@maqro/core/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/** Profile is the You hub: besides its own sub-sections it offers the
 *  registry's You-hub views — Targets opens the calculator. */

vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({
    user: null,
    localUserId: null,
    isOfflineUnverified: false,
    isLoaded: true,
    isUnconfigured: false,
  }),
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

afterEach(() => {
  cleanup();
});

describe("Profile as the You hub", () => {
  it("the Targets tile opens the calculator view", () => {
    const onSelectView = vi.fn();
    render(
      <ProfileView
        personalInfo={PROFILE}
        onPersonalInfoChange={() => {}}
        today="2026-06-10"
        onSelectView={onSelectView}
      />,
    );
    const tile = screen.getByRole("button", { name: /Targets/ });
    expect(tile.textContent).toContain("Calories, macros & goal");
    fireEvent.click(tile);
    expect(onSelectView).toHaveBeenCalledWith("calculator");
  });

  it("without a view switcher there is no Targets tile", () => {
    render(
      <ProfileView
        personalInfo={PROFILE}
        onPersonalInfoChange={() => {}}
        today="2026-06-10"
      />,
    );
    expect(screen.queryByRole("button", { name: /Targets/ })).toBeNull();
    // The hub's own sub-sections are unchanged.
    expect(
      screen.getByRole("button", { name: /My measurements/ }),
    ).toBeTruthy();
  });

  it("while the tab bar has a More tab, the hub doesn't repeat it", () => {
    render(
      <ProfileView
        personalInfo={PROFILE}
        onPersonalInfoChange={() => {}}
        today="2026-06-10"
        onSelectView={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /^More/ })).toBeNull();
  });
});
