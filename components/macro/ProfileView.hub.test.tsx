/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonalInfo } from "@maqro/core/types";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

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
        planWeek={() => null}
        onTrainingChange={() => {}}
        onProteinSettingChange={() => {}}
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
        planWeek={() => null}
        onTrainingChange={() => {}}
        onProteinSettingChange={() => {}}
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
        planWeek={() => null}
        onTrainingChange={() => {}}
        onProteinSettingChange={() => {}}
        onSelectView={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /^More/ })).toBeNull();
  });

  it("the hub's tiles sit above the long Body form", () => {
    render(
      <ProfileView
        personalInfo={PROFILE}
        onPersonalInfoChange={() => {}}
        today="2026-06-10"
        planWeek={() => null}
        onTrainingChange={() => {}}
        onProteinSettingChange={() => {}}
        onSelectView={() => {}}
      />,
    );
    const body = screen.getByRole("heading", { name: "Body" });
    for (const name of [/Targets/, /Training week/]) {
      const tile = screen.getByRole("button", { name });
      expect(
        tile.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });
});

describe("You hub sub-views", () => {
  it("the breadcrumb goes back without repeating the screen's title", () => {
    render(
      <ProfileView
        personalInfo={PROFILE}
        onPersonalInfoChange={() => {}}
        today="2026-06-10"
        planWeek={() => null}
        onTrainingChange={() => {}}
        onProteinSettingChange={() => {}}
        onSelectView={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /My measurements/ }));
    const back = screen.getByRole("button", { name: "Back to You" });
    const crumb = back.parentElement;
    if (!crumb) throw new Error("no breadcrumb");
    // The topbar already says "You": the crumb shows only where you are.
    expect(crumb.textContent).toBe("My measurements");
    expect(within(crumb).queryByText(/Profile|You/)).toBeNull();
    fireEvent.click(back);
    expect(screen.getByRole("heading", { name: "Body" })).toBeTruthy();
  });
});
