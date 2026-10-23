/**
 * @vitest-environment jsdom
 */
import {
  clearAllStores,
  getProfile,
  getProfileRecord,
  isProfileMarkedAsDemo,
} from "@/lib/db";
import { computeMacros } from "@/lib/macros";
import en from "@/messages/en.json";
import "fake-indexeddb/auto";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import MacroCalculator from "./macro-calculator";

/** The landing page's "Try with sample data" funnel lands on `/app?demo=1`.
 *  This renders the real app (guest mode: no Supabase env in tests) against
 *  fake-indexeddb and checks the first load the way a visitor sees it: the
 *  seeded profile and its target replace the defaults without a reload, and
 *  the first-run onboarding wizard (plus its anonymous funnel POST) stays out
 *  of a visit that is exploring sample data. */

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => window.location.pathname,
}));

// The tier fetch is irrelevant here; "loading" keeps goal phases off, so the
// target is the profile's linear goal (what a guest sees).
vi.mock("@/hooks/use-ai-usage", () => ({
  useAiUsage: () => ({ state: { status: "loading" } }),
}));

const ONBOARDING_EVENTS = "/api/onboarding/events";
/** Past the onboarding gate's 1.5 s safety timeout (macro-calculator). */
const PAST_ONBOARDING_GATE_MS = 2_000;

const fetchMock = vi.fn<typeof fetch>(
  async () => new Response("{}", { status: 404 }),
);

function onboardingPosts(): number {
  return fetchMock.mock.calls.filter(([input]) =>
    String(input).includes(ONBOARDING_EVENTS),
  ).length;
}

function installBrowserStubs(): void {
  vi.stubGlobal("fetch", fetchMock);
  // jsdom ships neither. Reduced motion makes NumberTicker snap to its value
  // instead of counting up, so the rendered target is the computed one.
  vi.stubGlobal(
    "matchMedia",
    (q: string) =>
      ({
        matches: q === "(prefers-reduced-motion: reduce)",
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      }) as unknown as MediaQueryList,
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}

function renderApp() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={en}
    >
      <MacroCalculator />
    </NextIntlClientProvider>,
  );
}

/** Resolves once the seed's profile is visible: the summary strip leads with
 *  the demo's sex/age instead of DEFAULT_PROFILE's "Male · 30 yrs". */
async function findDemoSummary(): Promise<HTMLElement> {
  return screen.findByText("Female", {}, { timeout: 3_000 });
}

/** Resolves once the seed routine has written its profile row — independent
 *  of whether the UI picked it up. */
async function seedWritten(): Promise<void> {
  await waitFor(async () => expect(await isProfileMarkedAsDemo()).toBe(true), {
    timeout: 3_000,
  });
}

/** Let the onboarding gate's safety timeout fire (and anything it renders
 *  settle) so an assertion that the wizard is absent is meaningful. */
async function passOnboardingGate(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PAST_ONBOARDING_GATE_MS);
  });
}

beforeEach(async () => {
  // Fake only the timer APIs (fake-indexeddb schedules on setImmediate, which
  // stays real) and let them advance with wall time so RTL's polling works;
  // `advanceTimersByTimeAsync` then jumps past the onboarding gate on demand.
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  installBrowserStubs();
  fetchMock.mockClear();
  await clearAllStores();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

// A full app render plus the 2 s gate wait outgrows vitest's 5 s default.
vi.setConfig({ testTimeout: 15_000 });

describe("?demo=1 first load", () => {
  it("shows the demo profile and its target without a reload", async () => {
    window.history.replaceState({}, "", "/app?demo=1");
    renderApp();

    const sex = await findDemoSummary();
    const strip = sex.parentElement;
    expect(strip).not.toBeNull();
    expect(strip?.textContent).toMatch(/32 yrs/);
    expect(strip?.textContent).toMatch(/68\.0 kg/);

    const seeded = await getProfile();
    expect(seeded).not.toBeNull();
    expect(seeded!.displayName).toBe("Sample");
    // The calculator pins the macro math to local midnight of today.
    const d = new Date();
    const midnight = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
    ).getTime();
    const expected = computeMacros(seeded!, midnight).targetCalories;
    // DEFAULT_PROFILE's target is 2556 kcal; the demo's must differ for the
    // check below to prove the seeded profile drives the target.
    expect(expected).not.toBe(2556);
    const tile = screen.getByText("Target", { selector: "p" }).parentElement;
    expect(tile).not.toBeNull();
    await waitFor(() =>
      expect(within(tile!).getByText(String(expected))).toBeTruthy(),
    );
  });

  it("does not open the onboarding wizard or count the visit in the funnel", async () => {
    window.history.replaceState({}, "", "/app?demo=1");
    renderApp();
    await seedWritten();
    await passOnboardingGate();

    expect(screen.queryByText("Welcome to Maqro")).toBeNull();
    expect(onboardingPosts()).toBe(0);
  });

  it("leaves the seeded profile row alone once it is loaded (no re-save)", async () => {
    window.history.replaceState({}, "", "/app?demo=1");
    renderApp();
    await findDemoSummary();
    const before = await getProfileRecord();
    // Past useProfile's 500 ms write debounce: a load-time merge must not be
    // written back as if it were an edit.
    await passOnboardingGate();
    const after = await getProfileRecord();
    expect(after?.localUpdatedAt).toBe(before?.localUpdatedAt);
  });

  it("shows the demo's cuisine preference as selected", async () => {
    window.history.replaceState({}, "", "/app?demo=1");
    renderApp();
    await findDemoSummary();

    const chip = screen.getByRole("button", { name: "Mediterranean" });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Italian" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("still onboards a genuine first visit (no ?demo=1)", async () => {
    window.history.replaceState({}, "", "/app");
    renderApp();
    await passOnboardingGate();

    expect(await screen.findByText("Welcome to Maqro")).toBeTruthy();
    expect(onboardingPosts()).toBeGreaterThan(0);
  });
});
