// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scrollIntoViewUntilStable } from "./scroll-into-view";

/** Capturable ResizeObserver stand-in: jsdom ships none, and we need to
 *  fire the callback by hand to simulate sections growing. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  callback: ResizeObserverCallback;
  observed: Element[] = [];
  disconnected = false;
  constructor(cb: ResizeObserverCallback) {
    this.callback = cb;
    FakeResizeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  /** Simulate a resize delivery. */
  fire() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function lastObserver(): FakeResizeObserver {
  const o = FakeResizeObserver.instances.at(-1);
  if (!o) throw new Error("no ResizeObserver constructed");
  return o;
}

/** Build a target inside a sibling wrapper, both attached to the body so
 *  `parentElement` resolves like it does in the real tree. */
function makeTarget(): { el: HTMLElement; scroll: ReturnType<typeof vi.fn> } {
  const wrapper = document.createElement("div");
  const el = document.createElement("section");
  wrapper.appendChild(el);
  document.body.appendChild(wrapper);
  const scroll = vi.fn();
  el.scrollIntoView = scroll;
  return { el, scroll };
}

describe("scrollIntoViewUntilStable", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("scrolls to the top on start and observes the sibling wrapper", () => {
    const { el, scroll } = makeTarget();
    const stop = scrollIntoViewUntilStable(el);

    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
    expect(lastObserver().observed).toEqual([el.parentElement]);
    stop();
  });

  it("re-pins on every observer delivery, including the first", () => {
    // The bug this guards against: skipping the re-pin on the initial
    // delivery loses growth that the observer coalesces into it.
    const { el, scroll } = makeTarget();
    const stop = scrollIntoViewUntilStable(el);
    const obs = lastObserver();
    scroll.mockClear();

    obs.fire(); // initial delivery → must still re-pin
    expect(scroll).toHaveBeenCalledTimes(1);
    obs.fire(); // later reflow → re-pin again
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(scroll).toHaveBeenLastCalledWith({
      behavior: "auto",
      block: "start",
    });
    stop();
  });

  it("does not start the settle countdown on the initial delivery", () => {
    // A section that grows a beat later (after a quiet gap) must not be
    // missed — only the first delivery is exempt from arming the timer.
    const { el } = makeTarget();
    scrollIntoViewUntilStable(el, { quietMs: 200, maxMs: 5000 });
    const obs = lastObserver();

    obs.fire(); // initial delivery (does not arm quiet)
    vi.advanceTimersByTime(1000); // long quiet gap...
    expect(obs.disconnected).toBe(false); // ...still following

    obs.fire(); // delayed growth → arms quiet
    vi.advanceTimersByTime(200);
    expect(obs.disconnected).toBe(true);
  });

  it("stops once the layout goes quiet after a real reflow", () => {
    const { el, scroll } = makeTarget();
    scrollIntoViewUntilStable(el, { quietMs: 200, maxMs: 5000 });
    const obs = lastObserver();
    obs.fire(); // prime
    obs.fire(); // real reflow → arms quiet
    scroll.mockClear();

    vi.advanceTimersByTime(200); // quiet window elapses
    expect(obs.disconnected).toBe(true);
    obs.fire(); // post-stop deliveries are inert
    expect(scroll).not.toHaveBeenCalled();
  });

  it("stops at the hard cap even under continuous reflow", () => {
    const { el } = makeTarget();
    scrollIntoViewUntilStable(el, { quietMs: 300, maxMs: 1000 });
    const obs = lastObserver();
    obs.fire(); // prime

    // Keep reflowing faster than quietMs so only maxMs can stop it.
    for (let t = 0; t < 1000; t += 100) {
      obs.fire();
      vi.advanceTimersByTime(100);
    }
    expect(obs.disconnected).toBe(true);
  });

  it("releases immediately on a manual scroll", () => {
    const { el, scroll } = makeTarget();
    scrollIntoViewUntilStable(el);
    const obs = lastObserver();
    scroll.mockClear();

    window.dispatchEvent(new Event("wheel"));
    expect(obs.disconnected).toBe(true);
    obs.fire();
    obs.fire();
    expect(scroll).not.toHaveBeenCalled();
  });

  it("cleanup disconnects the observer", () => {
    const { el, scroll } = makeTarget();
    const stop = scrollIntoViewUntilStable(el);
    const obs = lastObserver();
    scroll.mockClear();

    stop();
    expect(obs.disconnected).toBe(true);
    obs.fire();
    obs.fire();
    expect(scroll).not.toHaveBeenCalled();
  });

  it("falls back to a single smooth scroll without ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { el, scroll } = makeTarget();
    const stop = scrollIntoViewUntilStable(el);

    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(typeof stop).toBe("function");
    stop();
  });
});
