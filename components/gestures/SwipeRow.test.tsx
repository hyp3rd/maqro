/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SwipeRow } from "./SwipeRow";

/** Build a media-query matcher that pretends to be touch-or-mouse.
 *  jsdom doesn't ship matchMedia; the SwipeRow checks
 *  `(pointer: coarse)` via the shared useCoarsePointer hook, which
 *  reads window.matchMedia, so we install a controllable stub. */
function installMatchMedia(coarse: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (q: string) =>
      ({
        matches: q === "(pointer: coarse)" ? coarse : false,
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SwipeRow on a non-touch device", () => {
  beforeEach(() => installMatchMedia(false));

  it("renders children unwrapped — no reveal bars, no motion shell", () => {
    render(
      <SwipeRow
        onSwipeLeft={() => undefined}
        onSwipeRight={() => undefined}
        leftReveal={{ label: "Remove", intent: "danger" }}
        rightReveal={{ label: "To pantry", intent: "primary" }}
      >
        <span data-testid="row-content">Oats</span>
      </SwipeRow>,
    );

    // The reveal labels are inside `aria-hidden` strips; if SwipeRow
    // wired itself up, both would be present. On a mouse device we
    // want zero gesture chrome.
    expect(screen.queryByText("Remove")).toBeNull();
    expect(screen.queryByText("To pantry")).toBeNull();
    expect(screen.getByTestId("row-content")).not.toBeNull();
  });
});

describe("SwipeRow on a touch device", () => {
  beforeEach(() => installMatchMedia(true));

  it("renders both reveal bars when both swipes are configured", () => {
    render(
      <SwipeRow
        onSwipeLeft={() => undefined}
        onSwipeRight={() => undefined}
        leftReveal={{ label: "Remove", intent: "danger" }}
        rightReveal={{ label: "To pantry", intent: "primary" }}
      >
        <span>Oats</span>
      </SwipeRow>,
    );

    expect(screen.queryByText("Remove")).not.toBeNull();
    expect(screen.queryByText("To pantry")).not.toBeNull();
  });

  it("falls back to unwrapped children when disabled", () => {
    render(
      <SwipeRow
        disabled
        onSwipeLeft={() => undefined}
        leftReveal={{ label: "Remove", intent: "danger" }}
      >
        <span data-testid="row-content">Oats</span>
      </SwipeRow>,
    );

    expect(screen.queryByText("Remove")).toBeNull();
    expect(screen.getByTestId("row-content")).not.toBeNull();
  });

  it("renders only the configured reveal bar — undefined sides stay empty", () => {
    render(
      <SwipeRow
        onSwipeLeft={() => undefined}
        leftReveal={{ label: "Remove", intent: "danger" }}
      >
        <span>Oats</span>
      </SwipeRow>,
    );

    expect(screen.queryByText("Remove")).not.toBeNull();
    // No right-side action was wired, so its strip must not render.
    expect(screen.queryByText("To pantry")).toBeNull();
  });
});
