// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useElementWidth } from "./use-element-width";

/** jsdom ships no ResizeObserver: capture the instance and deliver
 *  entries by hand. */
class FakeResizeObserver {
  static last: FakeResizeObserver | null = null;
  callback: ResizeObserverCallback;
  observed: Element[] = [];
  disconnected = false;
  constructor(cb: ResizeObserverCallback) {
    this.callback = cb;
    FakeResizeObserver.last = this;
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  deliver(entry: Partial<ResizeObserverEntry>) {
    this.callback(
      [entry as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

function lastObserver(): FakeResizeObserver {
  const o = FakeResizeObserver.last;
  if (!o) throw new Error("no ResizeObserver constructed");
  return o;
}

/** Renders the observed element only when `show`, and prints the width. */
function Probe({ show = true }: { show?: boolean }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  return createElement(
    "section",
    null,
    createElement("output", null, width === null ? "none" : String(width)),
    show ? createElement("div", { ref, "data-testid": "observed" }) : null,
  );
}

const shown = () => screen.getByRole("status").textContent;

describe("useElementWidth", () => {
  beforeEach(() => {
    FakeResizeObserver.last = null;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("is null until the first observation, then tracks the content box", () => {
    render(createElement(Probe));
    expect(shown()).toBe("none");
    expect(lastObserver().observed).toEqual([screen.getByTestId("observed")]);

    act(() =>
      lastObserver().deliver({
        contentBoxSize: [{ inlineSize: 327.6, blockSize: 240 }],
        contentRect: { width: 0 } as DOMRectReadOnly,
      }),
    );
    expect(shown()).toBe("328");

    act(() =>
      lastObserver().deliver({
        contentBoxSize: [{ inlineSize: 702, blockSize: 240 }],
        contentRect: { width: 0 } as DOMRectReadOnly,
      }),
    );
    expect(shown()).toBe("702");
  });

  it("falls back to contentRect where contentBoxSize isn't an array", () => {
    render(createElement(Probe));
    act(() =>
      lastObserver().deliver({
        contentRect: { width: 412 } as DOMRectReadOnly,
      }),
    );
    expect(shown()).toBe("412");
  });

  it("keeps the last real width when the element collapses to 0", () => {
    render(createElement(Probe));
    act(() =>
      lastObserver().deliver({
        contentRect: { width: 300 } as DOMRectReadOnly,
      }),
    );
    act(() =>
      lastObserver().deliver({ contentRect: { width: 0 } as DOMRectReadOnly }),
    );
    expect(shown()).toBe("300");
  });

  it("observes an element that mounts after the first render", () => {
    const { rerender } = render(createElement(Probe, { show: false }));
    expect(FakeResizeObserver.last).toBeNull();
    rerender(createElement(Probe, { show: true }));
    expect(lastObserver().observed).toEqual([screen.getByTestId("observed")]);
  });

  it("disconnects when the element detaches", () => {
    const { rerender } = render(createElement(Probe));
    const observer = lastObserver();
    rerender(createElement(Probe, { show: false }));
    expect(observer.disconnected).toBe(true);
  });

  it("does not re-subscribe on re-render", () => {
    const { rerender } = render(createElement(Probe));
    const observer = lastObserver();
    act(() =>
      observer.deliver({ contentRect: { width: 200 } as DOMRectReadOnly }),
    );
    rerender(createElement(Probe));
    expect(FakeResizeObserver.last).toBe(observer);
    expect(observer.disconnected).toBe(false);
  });

  it("stays null where ResizeObserver doesn't exist", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(createElement(Probe));
    expect(shown()).toBe("none");
  });
});
