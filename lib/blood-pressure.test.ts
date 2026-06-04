import { describe, expect, it } from "vitest";
import { bloodPressureCategory } from "./blood-pressure";

describe("bloodPressureCategory", () => {
  it("classifies textbook readings", () => {
    expect(bloodPressureCategory(118, 75)).toBe("normal");
    expect(bloodPressureCategory(122, 76)).toBe("elevated");
    expect(bloodPressureCategory(134, 78)).toBe("stage1");
    expect(bloodPressureCategory(145, 95)).toBe("stage2");
    expect(bloodPressureCategory(190, 100)).toBe("crisis");
  });

  it("lets either number push the reading into a higher band", () => {
    // Elevated systolic but Stage-1 diastolic → Stage 1.
    expect(bloodPressureCategory(125, 85)).toBe("stage1");
    // Normal systolic but Stage-2 diastolic → Stage 2.
    expect(bloodPressureCategory(118, 92)).toBe("stage2");
    // Diastolic over 120 is a crisis regardless of a normal-ish systolic.
    expect(bloodPressureCategory(160, 125)).toBe("crisis");
  });

  it("classifies the band boundaries inclusively on the high side", () => {
    expect(bloodPressureCategory(120, 79)).toBe("elevated"); // 120 systolic
    expect(bloodPressureCategory(130, 79)).toBe("stage1"); // 130 systolic
    expect(bloodPressureCategory(119, 80)).toBe("stage1"); // 80 diastolic
    expect(bloodPressureCategory(140, 89)).toBe("stage2"); // 140 systolic
    expect(bloodPressureCategory(139, 90)).toBe("stage2"); // 90 diastolic
  });

  it("flags hypotension as low only when nothing high triggers", () => {
    expect(bloodPressureCategory(85, 55)).toBe("low");
    expect(bloodPressureCategory(112, 58)).toBe("low"); // low diastolic alone
    expect(bloodPressureCategory(88, 70)).toBe("low"); // low systolic alone
    // A high systolic with a low diastolic is staged high, not low.
    expect(bloodPressureCategory(135, 55)).toBe("stage1");
  });
});
