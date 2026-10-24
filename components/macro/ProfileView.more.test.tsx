/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonalInfo } from "@maqro/core/types";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

/** The Suggestions change takes "more" out of the tab bar (one edit to
 *  `TAB_BAR` in the nav registry); the More sheet must then open from the
 *  You hub without any change here. Simulated by the registry reporting no
 *  More tab. */

vi.mock("../shell/nav", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shell/nav")>()),
  MORE_IN_TAB_BAR: false,
}));
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

describe("You hub without a More tab", () => {
  it("offers More, whose sheet navigates and closes", async () => {
    const onSelectView = vi.fn();
    render(
      <ProfileView
        personalInfo={PROFILE}
        onPersonalInfoChange={() => {}}
        today="2026-06-10"
        onSelectView={onSelectView}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^More/ }));
    const sheet = screen.getByRole("dialog", { name: "More" });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Pantry" }));
    });
    expect(onSelectView).toHaveBeenCalledWith("pantry");
    expect(screen.queryByRole("dialog", { name: "More" })).toBeNull();
  });
});
