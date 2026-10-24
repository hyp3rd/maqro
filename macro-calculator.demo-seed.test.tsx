/**
 * @vitest-environment jsdom
 */
import {
  clearAllStores,
  getProfile,
  getProfileRecord,
  isProfileMarkedAsDemo,
  saveDemoProfile,
  todayKey,
} from "@/lib/db";
import { clearDemoModeData, getDemoProfile } from "@/lib/demo-data";
import {
  __resetSyncStatusForTests,
  setSynced,
  setSyncing,
} from "@/lib/sync-status";
import en from "@/messages/en.json";
import { useInsertionEffect } from "react";
import "fake-indexeddb/auto";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { targetsForDate } from "@maqro/core/targets";
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

/** The query string the router is rendering, when it differs from the address
 *  bar. A Next `<Link>` soft navigation renders the target route with its
 *  params in `useSearchParams` but only writes the URL in the commit phase
 *  (`HistoryUpdater`'s insertion effect), so during that render
 *  `window.location` still shows the previous page. `search: null` = in step. */
const router = vi.hoisted(() => ({ search: null as string | null }));

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(router.search ?? window.location.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => window.location.pathname,
}));

// The tier fetch is irrelevant here; "loading" keeps goal phases off, so the
// target is the profile's linear goal (what a guest sees).
vi.mock("@/hooks/use-ai-usage", () => ({
  useAiUsage: () => ({ state: { status: "loading" } }),
  useTier: () => ({ tier: null, resolved: false }),
  useRefreshAiUsage: () => () => {},
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
  // Motion's `useReducedMotion` asks for the bare "(prefers-reduced-motion)"
  // (and caches the first answer for the whole file); the app's own checks
  // ask for "(prefers-reduced-motion: reduce)". Both must match, or the
  // ticker animates and the target is read mid-count.
  vi.stubGlobal(
    "matchMedia",
    (q: string) =>
      ({
        matches:
          q === "(prefers-reduced-motion)" ||
          q === "(prefers-reduced-motion: reduce)",
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

/** Stands in for Next's `HistoryUpdater`: writes the navigated-to URL into
 *  the address bar in an insertion effect — after the route has rendered,
 *  before any of its layout or passive effects run. */
function HistoryWrite({ url }: { url: string }) {
  useInsertionEffect(() => {
    window.history.replaceState({}, "", url);
    router.search = null;
  }, [url]);
  return null;
}

/** Render the app the way the landing page's `<Link href="/app?demo=1">`
 *  reaches it: the router renders `url` while the address bar still shows
 *  `/`, then commits the URL. */
function renderAppBySoftNavigation(url: string) {
  window.history.replaceState({}, "", "/");
  router.search = new URL(url, window.location.origin).search;
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={en}
    >
      <MacroCalculator />
      <HistoryWrite url={url} />
    </NextIntlClientProvider>,
  );
}

/** The funnel lands on Today; the checks of the seeded profile's body data
 *  and inputs read the calculator (Targets), so they open it directly. */
const DEMO_ON_CALCULATOR = "/app?demo=1&view=calculator";

/** Resolves once the seed's profile is visible on the calculator: the summary
 *  strip leads with the demo's sex/age instead of DEFAULT_PROFILE's
 *  "Male · 30 yrs". */
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
  router.search = null;
  __resetSyncStatusForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

// A full app render plus the 2 s gate wait outgrows vitest's 5 s default.
vi.setConfig({ testTimeout: 15_000 });

describe("?demo=1 first load", () => {
  it("lands on Today with the seeded day", async () => {
    window.history.replaceState({}, "", "/app?demo=1");
    renderApp();
    expect(
      screen.getByRole("heading", { level: 1, name: "Today" }),
    ).toBeTruthy();
    // Today's sample meals show without a reload.
    expect(
      (await screen.findAllByText("Greek Yogurt", {}, { timeout: 3_000 }))
        .length,
    ).toBeGreaterThan(0);
    // The seed strips `?demo=1` as its last step: wait for it, so none of
    // its later writes (weights, water) land in the next test's stores.
    await waitFor(
      () => expect(window.location.search).not.toContain("demo=1"),
      { timeout: 3_000 },
    );
  });

  it("shows the demo profile and its target without a reload", async () => {
    window.history.replaceState({}, "", DEMO_ON_CALCULATOR);
    renderApp();

    const sex = await findDemoSummary();
    const strip = sex.parentElement;
    expect(strip).not.toBeNull();
    expect(strip?.textContent).toMatch(/32 yrs/);
    expect(strip?.textContent).toMatch(/68\.0 kg/);

    const seeded = await getProfile();
    expect(seeded).not.toBeNull();
    expect(seeded!.displayName).toBe("Sample");
    // The calculator shows today's target through the shared resolver: the
    // demo plans a training week, so that is today's PLANNED day (no goal
    // phases while the tier loads, no body measurements in the seed).
    const expected = targetsForDate(seeded!, todayKey(), {
      phasesEnabled: false,
      bodyFatPct: null,
    }).targetCalories;
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

  it("keeps the wizard and the funnel POST out of a soft navigation from the landing page", async () => {
    renderAppBySoftNavigation("/app?demo=1");
    // The URL write landed before DemoSeed's effect, which seeded.
    await seedWritten();
    await passOnboardingGate();

    expect(screen.queryByText("Welcome to Maqro")).toBeNull();
    expect(onboardingPosts()).toBe(0);
  });

  it("leaves the seeded profile row alone once it is loaded (no re-save)", async () => {
    window.history.replaceState({}, "", DEMO_ON_CALCULATOR);
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
    window.history.replaceState({}, "", DEMO_ON_CALCULATOR);
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

describe("signing in after exploring the sample data", () => {
  it("keeps the wizard closed until the sign-in sync has pulled", async () => {
    // The load after the sign-in redirect: the seeded dataset is still in
    // IndexedDB and this device never finished onboarding.
    await saveDemoProfile(getDemoProfile());
    window.history.replaceState({}, "", "/app?view=calculator");
    renderApp();
    await findDemoSummary();

    // SyncManager's sign-in chain: wipe the sample, then start the pull.
    await act(async () => {
      await clearDemoModeData();
      setSyncing();
    });
    await waitFor(() => expect(screen.queryByText("Female")).toBeNull());
    await passOnboardingGate();

    // A returning account's profile may still land with this pull.
    expect(screen.queryByText("Welcome to Maqro")).toBeNull();
    expect(onboardingPosts()).toBe(0);

    // The pull brought no profile: a new account, which is onboarded.
    act(() => setSynced());
    expect(await screen.findByText("Welcome to Maqro")).toBeTruthy();
  });
});
