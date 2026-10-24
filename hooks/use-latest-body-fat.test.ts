/**
 * @vitest-environment jsdom
 */
import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { estimateBodyFat } from "@maqro/core/body-fat";
import type { PersonalInfo } from "@maqro/core/types";
import { act, renderHook, waitFor } from "@testing-library/react";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
});

const PROFILE: Pick<PersonalInfo, "gender" | "height"> = {
  gender: "male",
  height: 178,
};
const bf = (waistCm: number, neckCm: number) =>
  estimateBodyFat({ bodyType: "male", heightCm: 178, waistCm, neckCm });

describe("useLatestBodyFatPct", () => {
  it("estimates from the latest usable measurement and follows new saves", async () => {
    const { saveBodyMeasurement } = await import("@/lib/db");
    const { useLatestBodyFatPct } = await import("./use-latest-body-fat");
    await saveBodyMeasurement("2026-10-01", { waistCm: 90, neckCm: 38 });
    // A newer waist-only check-in has no neck: it is skipped.
    await saveBodyMeasurement("2026-10-10", { waistCm: 86 });

    const { result } = renderHook(() => useLatestBodyFatPct(PROFILE));
    await waitFor(() => expect(result.current).toBe(bf(90, 38)));

    await act(async () => {
      await saveBodyMeasurement("2026-10-20", { waistCm: 84, neckCm: 38 });
    });
    await waitFor(() => expect(result.current).toBe(bf(84, 38)));
  });

  it("follows a profile edit: no estimate for a gender with no published formula", async () => {
    const { saveBodyMeasurement } = await import("@/lib/db");
    const { useLatestBodyFatPct } = await import("./use-latest-body-fat");
    await saveBodyMeasurement("2026-10-01", { waistCm: 90, neckCm: 38 });
    const { result, rerender } = renderHook(
      (profile: Pick<PersonalInfo, "gender" | "height">) =>
        useLatestBodyFatPct(profile),
      { initialProps: PROFILE },
    );
    await waitFor(() => expect(result.current).toBe(bf(90, 38)));
    rerender({ gender: "nonbinary", height: 178 });
    expect(result.current).toBeNull();
  });
});
