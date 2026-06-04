import type { PersonalInfo } from "@/components/macro/types";
import { describe, expect, it } from "vitest";
import { ageFromBirthDate, effectiveAge } from "./age";

// `now` is built with the LOCAL Date constructor (year, monthIndex, day) so
// that `ageFromBirthDate`'s local getFullYear/getMonth/getDate reads round-trip
// exactly, regardless of the test runner's timezone. monthIndex is 0-based:
// month 5 = June, 1 = February, 2 = March.
const JUN_15_2026 = new Date(2026, 5, 15).getTime();

const baseProfile: PersonalInfo = {
  gender: "male",
  age: 40,
  weight: 70,
  height: 175,
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

describe("ageFromBirthDate", () => {
  it("counts whole years on the birthday itself", () => {
    expect(ageFromBirthDate("1990-06-15", JUN_15_2026)).toBe(36);
  });

  it("subtracts a year when this year's birthday hasn't passed yet", () => {
    // Born 25 Dec — by 15 Jun the 2026 birthday is still ~6 months out.
    expect(ageFromBirthDate("1990-12-25", JUN_15_2026)).toBe(35);
  });

  it("counts the year once the birthday has already passed", () => {
    expect(ageFromBirthDate("1990-01-10", JUN_15_2026)).toBe(36);
  });

  it("treats the day before the birthday as the lower age", () => {
    // Born 16 Jun; on 15 Jun 2026 they're still 35 (turn 36 tomorrow).
    expect(ageFromBirthDate("1990-06-16", JUN_15_2026)).toBe(35);
  });

  it("handles a leap-day birthdate across the Feb 28 / Mar 1 boundary", () => {
    // Born 29 Feb 2000. 2026 is not a leap year: on 28 Feb they're still 25,
    // ticking over to 26 on 1 Mar.
    expect(
      ageFromBirthDate("2000-02-29", new Date(2026, 1, 28).getTime()),
    ).toBe(25);
    expect(ageFromBirthDate("2000-02-29", new Date(2026, 2, 1).getTime())).toBe(
      26,
    );
  });

  it("returns null for a missing, empty, or unparseable date", () => {
    expect(ageFromBirthDate(undefined, JUN_15_2026)).toBeNull();
    expect(ageFromBirthDate(null, JUN_15_2026)).toBeNull();
    expect(ageFromBirthDate("", JUN_15_2026)).toBeNull();
    expect(ageFromBirthDate("not-a-date", JUN_15_2026)).toBeNull();
    expect(ageFromBirthDate("1990", JUN_15_2026)).toBeNull();
  });

  it("rejects a future birthdate (negative age)", () => {
    expect(ageFromBirthDate("2030-01-01", JUN_15_2026)).toBeNull();
  });

  it("rejects an implausibly old birthdate (> 130 years)", () => {
    expect(ageFromBirthDate("1850-01-01", JUN_15_2026)).toBeNull();
  });
});

describe("effectiveAge", () => {
  it("prefers the birthdate-derived age over the stored age", () => {
    const profile = { ...baseProfile, age: 99, birthDate: "1990-06-15" };
    expect(effectiveAge(profile, JUN_15_2026)).toBe(36);
  });

  it("falls back to the stored age when there is no birthdate", () => {
    expect(effectiveAge(baseProfile, JUN_15_2026)).toBe(40);
  });

  it("falls back to the stored age when the birthdate is unparseable", () => {
    const profile = { ...baseProfile, age: 40, birthDate: "garbage" };
    expect(effectiveAge(profile, JUN_15_2026)).toBe(40);
  });

  it("re-derives the age as time moves forward (silent re-targeting)", () => {
    const profile = { ...baseProfile, birthDate: "1990-06-15" };
    expect(effectiveAge(profile, new Date(2026, 5, 14).getTime())).toBe(35);
    expect(effectiveAge(profile, new Date(2026, 5, 15).getTime())).toBe(36);
  });
});
