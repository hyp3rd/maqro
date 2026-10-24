/**
 * @vitest-environment jsdom
 */
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import { afterEach, describe, expect, it, vi } from "vitest";
import { weekTargets } from "@maqro/core/targets";
import { defaultTrainingSchedule } from "@maqro/core/training-edit";
import type { PersonalInfo } from "@maqro/core/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/** Profile ("You") → Training week: a tile in the hub opens the editor,
 *  and its hint says whether the week is planned. */

vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({
    user: null,
    localUserId: null,
    isOfflineUnverified: false,
    isLoaded: true,
    isUnconfigured: false,
  }),
}));
// Opened from the editor's body-fat note; only that it opens matters here.
vi.mock("./BloodPressureSection", () => ({
  BloodPressureSection: () => <p>blood pressure</p>,
}));
vi.mock("./BodyMeasurementHistory", () => ({
  BodyMeasurementHistory: () => <p>measurement history</p>,
}));

const { ProfileView } = await import("./ProfileView");

const TODAY = "2026-10-24";
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

afterEach(cleanup);

function renderProfile(profile: PersonalInfo, onTrainingChange = vi.fn()) {
  render(
    <ProfileView
      personalInfo={profile}
      onPersonalInfoChange={() => {}}
      today={TODAY}
      planWeek={(p) => weekTargets(p, TODAY, { phasesEnabled: false })}
      onTrainingChange={onTrainingChange}
      onProteinSettingChange={() => {}}
    />,
    { wrapper: intlWrapper() },
  );
  return onTrainingChange;
}

describe("ProfileView: Training week", () => {
  it("the tile opens the editor; enabling writes through onTrainingChange", () => {
    const onTrainingChange = renderProfile(PROFILE);
    const tile = screen.getByRole("button", { name: /Training week/ });
    expect(tile.textContent).toContain("Plan targets by session");
    fireEvent.click(tile);
    expect(
      screen.getByRole("heading", { level: 2, name: "Training week" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("switch", { name: "Plan targets by training day" }),
    );
    expect(onTrainingChange).toHaveBeenCalledWith(defaultTrainingSchedule());
  });

  it("the tile counts the planned sessions while the week is on", () => {
    renderProfile({ ...PROFILE, training: defaultTrainingSchedule() });
    expect(
      screen.getByRole("button", { name: /Training week/ }).textContent,
    ).toContain("4 sessions a week");
  });

  it("the body-fat note opens My measurements", () => {
    renderProfile({
      ...PROFILE,
      training: defaultTrainingSchedule(),
      proteinSetting: { basis: "leanMass", gPerKg: 2.4 },
    });
    fireEvent.click(screen.getByRole("button", { name: /Training week/ }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add measurements in My measurements",
      }),
    );
    expect(screen.getByText("measurement history")).toBeTruthy();
  });
});
