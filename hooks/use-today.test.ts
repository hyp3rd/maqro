/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useToday } from "./use-today";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useToday", () => {
  it("returns the current local date key on mount", () => {
    vi.setSystemTime(new Date(2026, 4, 13, 14, 30, 0)); // 2026-05-13 14:30
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe("2026-05-13");
  });

  it("flips to the next day after midnight rolls over", () => {
    vi.setSystemTime(new Date(2026, 4, 13, 23, 59, 30)); // 30s before midnight
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe("2026-05-13");

    // Advance past midnight (+ the 1s buffer).
    act(() => {
      vi.advanceTimersByTime(31_000); // 31s → now 00:00:01 next day
    });
    expect(result.current).toBe("2026-05-14");
  });

  it("survives multiple day boundaries (reschedules)", () => {
    vi.setSystemTime(new Date(2026, 4, 13, 23, 59, 30));
    const { result } = renderHook(() => useToday());

    // Day 1 → 2
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(result.current).toBe("2026-05-14");

    // Day 2 → 3 (24h - 1s buffer = 86399s)
    act(() => {
      vi.advanceTimersByTime(86_400_000); // a full day
    });
    expect(result.current).toBe("2026-05-15");
  });

  it("returns the snapshot value across re-renders", () => {
    vi.setSystemTime(new Date(2026, 4, 13, 10, 0, 0));
    const { result, rerender } = renderHook(() => useToday());
    expect(result.current).toBe("2026-05-13");
    rerender();
    expect(result.current).toBe("2026-05-13");
  });
});
