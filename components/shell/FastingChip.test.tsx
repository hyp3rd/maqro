/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

/** The Topbar's fasting chip repeats the day view's Fasting card countdown,
 *  so while the card is on screen the chip steps aside (desktop showed the
 *  same countdown twice); once the card scrolls away, or isn't rendered
 *  (another view, another day), the chip is back. */

vi.mock("@/hooks/use-fasting-status", () => ({
  useFastingStatus: () => ({
    status: {
      phase: "fasting",
      remainingMin: 78,
      elapsedMin: 882,
      progress: 0.9,
      fastStartedAt: Date.UTC(2026, 5, 9, 17, 33),
    },
    fasting: { enabled: true, protocol: "16:8" },
    fastingHours: 16,
    logs: [],
    isHydrated: true,
    startFast: async () => {},
    stopFast: async () => {},
    disableFasting: async () => {},
    setFastStart: async () => {},
    updateFasting: async () => {},
  }),
}));

/** The observers the card created, to drive by hand (jsdom has none). */
const observers = vi.hoisted(
  () =>
    [] as {
      callback: (entries: { isIntersecting: boolean }[]) => void;
      disconnected: boolean;
    }[],
);

class FakeIntersectionObserver {
  private readonly record: (typeof observers)[number];
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    this.record = { callback, disconnected: false };
    observers.push(this.record);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.record.disconnected = true;
  }
  takeRecords() {
    return [];
  }
}

const { FastingChip } = await import("./FastingChip");
const { FastingCard } = await import("../macro/FastingCard");
const { FastingCardVisibilityProvider } =
  await import("./fasting-card-visibility");

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const chip = () => screen.queryByRole("button", { name: /^Fasting — / });

function Shell({ withCard }: { withCard: boolean }) {
  return (
    <FastingCardVisibilityProvider>
      <FastingChip onSelectView={() => {}} />
      {withCard && <FastingCard />}
    </FastingCardVisibilityProvider>
  );
}

function scroll(isIntersecting: boolean) {
  const live = observers.filter((o) => !o.disconnected);
  expect(live).toHaveLength(1);
  act(() => live[0]?.callback([{ isIntersecting }]));
}

describe("FastingChip beside the Fasting card", () => {
  it("shows when the page has no Fasting card", () => {
    render(<Shell withCard={false} />);
    expect(chip()).toBeTruthy();
  });

  it("steps aside while the card is on screen and returns once it scrolls away", () => {
    render(<Shell withCard />);
    scroll(true);
    expect(chip()).toBeNull();
    scroll(false);
    expect(chip()).toBeTruthy();
  });

  it("returns when the card leaves the page", () => {
    const view = render(<Shell withCard />);
    scroll(true);
    expect(chip()).toBeNull();
    view.rerender(<Shell withCard={false} />);
    expect(chip()).toBeTruthy();
    expect(observers.every((o) => o.disconnected)).toBe(true);
  });
});
