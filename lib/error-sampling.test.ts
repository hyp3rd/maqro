/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  DROP_WINDOW,
  KEEP_FIRST,
  recordAndShouldLog,
  shouldLogOccurrence,
} from "./error-sampling";

describe("shouldLogOccurrence", () => {
  it("logs the first KEEP_FIRST occurrences in full", () => {
    for (let n = 1; n <= KEEP_FIRST; n += 1) {
      expect(shouldLogOccurrence(n)).toBe(true);
    }
  });

  it("drops the window right after the initial burst", () => {
    expect(shouldLogOccurrence(KEEP_FIRST + 1)).toBe(false);
    expect(shouldLogOccurrence(KEEP_FIRST + DROP_WINDOW)).toBe(false);
  });

  it("keeps one occurrence per (DROP_WINDOW + 1) cycle thereafter", () => {
    // With 3/100: keep 104, 205, 306; drop everything between.
    expect(shouldLogOccurrence(104)).toBe(true);
    expect(shouldLogOccurrence(105)).toBe(false);
    expect(shouldLogOccurrence(205)).toBe(true);
    expect(shouldLogOccurrence(306)).toBe(true);
  });

  it("logs roughly 1% of a sustained flood", () => {
    let logged = 0;
    for (let n = 1; n <= 1010; n += 1) {
      if (shouldLogOccurrence(n)) logged += 1;
    }
    // 3 initial (1,2,3) + 9 sampled (104,205,…,912) across 1010 = 12,
    // i.e. ≈1.2% reaches the database.
    expect(logged).toBe(12);
  });
});

describe("recordAndShouldLog", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("throttles repeats of an identical signature across calls", () => {
    const sig = "error|/app|Boom";
    const results = Array.from({ length: 104 }, () => recordAndShouldLog(sig));
    // occurrences 1,2,3 logged, 4..103 dropped, 104 logged again.
    expect(results.slice(0, 3)).toEqual([true, true, true]);
    expect(results.slice(3, 103).some(Boolean)).toBe(false);
    expect(results[103]).toBe(true);
  });

  it("gives distinct signatures independent budgets", () => {
    expect(recordAndShouldLog("error|/a|X")).toBe(true);
    expect(recordAndShouldLog("error|/a|X")).toBe(true);
    expect(recordAndShouldLog("error|/a|X")).toBe(true);
    expect(recordAndShouldLog("error|/a|X")).toBe(false); // 4th of X dropped
    // A different signature starts fresh and logs immediately.
    expect(recordAndShouldLog("warning|/b|Y")).toBe(true);
  });

  it("persists the count across calls within the session", () => {
    const sig = "error|/app|Persisted";
    recordAndShouldLog(sig);
    recordAndShouldLog(sig);
    // A fresh read of storage still remembers the two prior occurrences,
    // so the 3rd is the last full log and the 4th is dropped.
    expect(recordAndShouldLog(sig)).toBe(true); // 3rd
    expect(recordAndShouldLog(sig)).toBe(false); // 4th
  });
});
