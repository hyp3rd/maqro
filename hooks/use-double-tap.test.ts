/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDoubleTap } from "./use-double-tap";

/** Synthetic React PointerEvent shape we hand into onPointerUp. The
 *  hook only reads `pointerType`, so a hand-rolled stub is plenty —
 *  no need to drag jsdom's full PointerEvent ceremony in. */
function pointerUp(pointerType: "touch" | "mouse" | "pen") {
  return { pointerType } as unknown as React.PointerEvent<HTMLElement>;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDoubleTap", () => {
  it("fires onDoubleTap when two taps land inside the window", () => {
    const onDoubleTap = vi.fn();
    const onSingleTap = vi.fn();
    const { result } = renderHook(() =>
      useDoubleTap({ onDoubleTap, onSingleTap }),
    );

    result.current.onPointerUp(pointerUp("touch"));
    // Advance by 100 ms — well inside the 260 ms window.
    vi.advanceTimersByTime(100);
    result.current.onPointerUp(pointerUp("touch"));

    expect(onDoubleTap).toHaveBeenCalledTimes(1);
    expect(onSingleTap).not.toHaveBeenCalled();
  });

  it("fires onSingleTap when the second tap arrives after the window", () => {
    const onDoubleTap = vi.fn();
    const onSingleTap = vi.fn();
    const { result } = renderHook(() =>
      useDoubleTap({ onDoubleTap, onSingleTap }),
    );

    result.current.onPointerUp(pointerUp("touch"));
    // Let the 260 ms timer fire — that's the single-tap commit point.
    vi.advanceTimersByTime(260);
    expect(onSingleTap).toHaveBeenCalledTimes(1);

    // A subsequent tap should start a fresh window, not be treated as
    // the second half of a stale double.
    result.current.onPointerUp(pointerUp("touch"));
    vi.advanceTimersByTime(260);
    expect(onSingleTap).toHaveBeenCalledTimes(2);
    expect(onDoubleTap).not.toHaveBeenCalled();
  });

  it("never fires onSingleTap when it isn't supplied (double-tap-only surface)", () => {
    const onDoubleTap = vi.fn();
    const { result } = renderHook(() => useDoubleTap({ onDoubleTap }));

    result.current.onPointerUp(pointerUp("touch"));
    vi.advanceTimersByTime(500);
    // Without onSingleTap there's nothing to fire on the timeout; the
    // hook should not throw or schedule a spurious callback.
    expect(onDoubleTap).not.toHaveBeenCalled();

    // A second tap still resolves to a double.
    result.current.onPointerUp(pointerUp("touch"));
    vi.advanceTimersByTime(100);
    result.current.onPointerUp(pointerUp("touch"));
    expect(onDoubleTap).toHaveBeenCalledTimes(1);
  });

  it("bypasses the double-tap delay for mouse input", () => {
    const onDoubleTap = vi.fn();
    const onSingleTap = vi.fn();
    const { result } = renderHook(() =>
      useDoubleTap({ onDoubleTap, onSingleTap }),
    );

    result.current.onPointerUp(pointerUp("mouse"));
    // No timer needed — mouse path is synchronous.
    expect(onSingleTap).toHaveBeenCalledTimes(1);
    expect(onDoubleTap).not.toHaveBeenCalled();
  });

  it("cancels a pending single-tap when the double fires", () => {
    const onDoubleTap = vi.fn();
    const onSingleTap = vi.fn();
    const { result } = renderHook(() =>
      useDoubleTap({ onDoubleTap, onSingleTap }),
    );

    result.current.onPointerUp(pointerUp("touch"));
    result.current.onPointerUp(pointerUp("touch"));
    // Pump well past the single-tap window; the pending timer must
    // have been cleared by the double-tap branch.
    vi.advanceTimersByTime(1000);

    expect(onDoubleTap).toHaveBeenCalledTimes(1);
    expect(onSingleTap).not.toHaveBeenCalled();
  });
});
