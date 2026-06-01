import { describe, expect, it } from "vitest";
import {
  buildShareBadgePageUrl,
  buildShareBadgeUrl,
  parseShareBadgeParams,
} from "./share-badge";

describe("buildShareBadgeUrl", () => {
  it("rounds non-integer macros to whole numbers", () => {
    const url = buildShareBadgeUrl("https://maqro.app", {
      caloriesCurrent: 1576.4,
      caloriesTarget: 1682,
      proteinCurrent: 230.7,
      proteinTarget: 231,
      carbsCurrent: 81.2,
      carbsTarget: 126,
      fatCurrent: 25.9,
      fatTarget: 28,
    });
    const params = new URL(url).searchParams;
    expect(params.get("kc")).toBe("1576");
    expect(params.get("pc")).toBe("231"); // 230.7 rounds up
    expect(params.get("fc")).toBe("26");
  });

  it("coerces negative or non-finite values to 0", () => {
    const url = buildShareBadgeUrl("https://maqro.app", {
      caloriesCurrent: -50,
      caloriesTarget: Number.NaN,
      proteinCurrent: Number.POSITIVE_INFINITY,
      proteinTarget: 0,
      carbsCurrent: 0,
      carbsTarget: 0,
      fatCurrent: 0,
      fatTarget: 0,
    });
    const params = new URL(url).searchParams;
    expect(params.get("kc")).toBe("0");
    expect(params.get("kt")).toBe("0");
    expect(params.get("pc")).toBe("0");
  });

  it("targets the og route", () => {
    const url = buildShareBadgeUrl("https://maqro.app", {
      caloriesCurrent: 0,
      caloriesTarget: 0,
      proteinCurrent: 0,
      proteinTarget: 0,
      carbsCurrent: 0,
      carbsTarget: 0,
      fatCurrent: 0,
      fatTarget: 0,
    });
    expect(url).toMatch(
      /^https:\/\/maqro\.app\/api\/share\/today\/og\?[a-z]+=/,
    );
  });

  it("appends sig when provided", () => {
    const url = buildShareBadgeUrl(
      "https://maqro.app",
      {
        caloriesCurrent: 1576,
        caloriesTarget: 1682,
        proteinCurrent: 230,
        proteinTarget: 231,
        carbsCurrent: 81,
        carbsTarget: 126,
        fatCurrent: 25,
        fatTarget: 28,
      },
      "abc123def",
    );
    expect(new URL(url).searchParams.get("sig")).toBe("abc123def");
  });

  it("omits sig when not provided", () => {
    const url = buildShareBadgeUrl("https://maqro.app", {
      caloriesCurrent: 1,
      caloriesTarget: 1,
      proteinCurrent: 1,
      proteinTarget: 1,
      carbsCurrent: 1,
      carbsTarget: 1,
      fatCurrent: 1,
      fatTarget: 1,
    });
    expect(new URL(url).searchParams.has("sig")).toBe(false);
  });
});

describe("buildShareBadgePageUrl", () => {
  const NUMBERS = {
    caloriesCurrent: 1576,
    caloriesTarget: 1682,
    proteinCurrent: 230,
    proteinTarget: 231,
    carbsCurrent: 81,
    carbsTarget: 126,
    fatCurrent: 25,
    fatTarget: 28,
  };

  it("targets the /share/today unfurl page", () => {
    const url = buildShareBadgePageUrl("https://maqro.app", NUMBERS);
    expect(url).toMatch(/^https:\/\/maqro\.app\/share\/today\?[a-z]+=/);
  });

  it("uses the same query shape as the og url so they share signing", () => {
    const sig = "shared-sig";
    const ogUrl = new URL(
      buildShareBadgeUrl("https://maqro.app", NUMBERS, sig),
    );
    const pageUrl = new URL(
      buildShareBadgePageUrl("https://maqro.app", NUMBERS, sig),
    );
    // Both URLs must carry identical params (incl. sig) — the
    // HMAC verifies the numbers, so any drift between the two
    // surfaces means one rejects what the other accepts.
    expect(pageUrl.searchParams.toString()).toBe(ogUrl.searchParams.toString());
  });
});

describe("parseShareBadgeParams", () => {
  it("round-trips with buildShareBadgeUrl", () => {
    const numbers = {
      caloriesCurrent: 1576,
      caloriesTarget: 1682,
      proteinCurrent: 230,
      proteinTarget: 231,
      carbsCurrent: 81,
      carbsTarget: 126,
      fatCurrent: 25,
      fatTarget: 28,
    };
    const url = new URL(buildShareBadgeUrl("https://maqro.app", numbers));
    const parsed = parseShareBadgeParams(url.searchParams);
    expect(parsed).toEqual(numbers);
  });

  it("clamps values above the per-field maximum", () => {
    const params = new URLSearchParams({
      kc: "9999999", // calorie cap 99,999
      pc: "9999999", // protein cap 9,999
    });
    const parsed = parseShareBadgeParams(params);
    expect(parsed.caloriesCurrent).toBe(99_999);
    expect(parsed.proteinCurrent).toBe(9_999);
  });

  it("treats missing params as 0 so the renderer never NaN-divides", () => {
    const parsed = parseShareBadgeParams(new URLSearchParams());
    expect(parsed).toEqual({
      caloriesCurrent: 0,
      caloriesTarget: 0,
      proteinCurrent: 0,
      proteinTarget: 0,
      carbsCurrent: 0,
      carbsTarget: 0,
      fatCurrent: 0,
      fatTarget: 0,
    });
  });

  it("rejects non-numeric or infinite strings as 0", () => {
    const params = new URLSearchParams({
      kc: "abc",
      pc: "1e9999", // Number("1e9999") → Infinity → coerced to 0
      cc: "",
    });
    const parsed = parseShareBadgeParams(params);
    expect(parsed.caloriesCurrent).toBe(0);
    expect(parsed.proteinCurrent).toBe(0);
    expect(parsed.carbsCurrent).toBe(0);
  });

  it("floors floats to non-negative integers", () => {
    const params = new URLSearchParams({ pc: "230.9", fc: "-5" });
    const parsed = parseShareBadgeParams(params);
    expect(parsed.proteinCurrent).toBe(230);
    expect(parsed.fatCurrent).toBe(0);
  });
});
