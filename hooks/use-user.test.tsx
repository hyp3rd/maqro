/**
 * @vitest-environment jsdom
 */
import { writeCachedTier } from "@/lib/billing/tier-cache";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersonalInfo } from "@maqro/core/types";
import {
  AuthRetryableFetchError,
  AuthSessionMissingError,
  type AuthChangeEvent,
  type AuthError,
  type Session,
  type User,
} from "@supabase/supabase-js";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { AiUsageProvider } from "./use-ai-usage";
import { useTargets } from "./use-targets";
import { useUser } from "./use-user";

/** A PWA started offline must keep its signed-in identity. The real auth-js
 *  sequence offline: INITIAL_SESSION delivers the persisted session's user
 *  (no network needed), then `getUser()` — a `/auth/v1/user` round-trip —
 *  resolves `{ user: null }` with an `AuthRetryableFetchError`. That null is
 *  "couldn't ask the server", not "signed out". */

type GetUserResult = { data: { user: User | null }; error: AuthError | null };

/** A stand-in for the browser auth client that reproduces the ordering above:
 *  INITIAL_SESSION fires first, `getUser()` settles only when the test
 *  releases it. */
function fakeAuthClient(persisted: Session | null) {
  let releaseGetUser: (result: GetUserResult) => void = () => {};
  const getUserSettled = new Promise<GetUserResult>((resolve) => {
    releaseGetUser = resolve;
  });
  const client = {
    auth: {
      getUser: () => getUserSettled,
      getSession: () =>
        Promise.resolve({ data: { session: persisted }, error: null }),
      onAuthStateChange: (
        callback: (event: AuthChangeEvent, session: Session | null) => void,
      ) => {
        queueMicrotask(() => callback("INITIAL_SESSION", persisted));
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  };
  return { client, releaseGetUser };
}

const supabase = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => supabase.client,
}));

const USER = { id: "u1" } as User;
const SESSION = { user: USER } as Session;
const offlineGetUser: GetUserResult = {
  data: { user: null },
  error: new AuthRetryableFetchError("Failed to fetch", 0),
};

const fetchMock =
  vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Renders `useUser` against a fake client and waits for INITIAL_SESSION. */
async function startWith(persisted: Session | null) {
  const fake = fakeAuthClient(persisted);
  supabase.client = fake.client;
  const hook = renderHook(() => useUser());
  await waitFor(() =>
    expect(hook.result.current.user).toBe(persisted?.user ?? null),
  );
  expect(hook.result.current.isLoaded).toBe(false);
  return { ...hook, releaseGetUser: fake.releaseGetUser };
}

describe("useUser", () => {
  it("offline: a network failure keeps the persisted session's user", async () => {
    const { result, releaseGetUser } = await startWith(SESSION);
    await act(async () => releaseGetUser(offlineGetUser));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.user).toBe(USER);
  });

  it("offline with no usable persisted session: signed out", async () => {
    const { result, releaseGetUser } = await startWith(null);
    await act(async () => releaseGetUser(offlineGetUser));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.user).toBeNull();
  });

  it("a session the server rejects still signs out", async () => {
    const { result, releaseGetUser } = await startWith(SESSION);
    await act(async () =>
      releaseGetUser({
        data: { user: null },
        error: new AuthSessionMissingError(),
      }),
    );
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.user).toBeNull();
  });

  it("online: the server-verified user wins", async () => {
    const verified = { id: "u1", email: "a@example.com" } as User;
    const { result, releaseGetUser } = await startWith(SESSION);
    await act(async () =>
      releaseGetUser({ data: { user: verified }, error: null }),
    );
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.user).toBe(verified);
  });

  it("unconfigured: loaded at once, no user", () => {
    supabase.client = null;
    const { result } = renderHook(() => useUser());
    expect(result.current).toEqual({
      user: null,
      isLoaded: true,
      isUnconfigured: true,
    });
  });
});

/** Linear goal: maintain at 2600. An active cut (−550/day, maintenance
 *  2450) puts today's Pro target at 1900. */
const TODAY = "2026-06-10";
const PROFILE: PersonalInfo = {
  gender: "male",
  age: 30,
  weight: 80,
  height: 180,
  activityLevel: "moderate",
  goal: "maintain",
  dietType: "balanced",
  dietPreference: "omnivore",
  cuisinePreferences: [],
  allergies: [],
  dislikedFoods: [],
  weeklyRateKg: 0,
  manualTdee: 2600,
  units: "metric",
  goalPhases: [
    {
      id: "ph_cut",
      kind: "cut",
      startDate: "2026-06-01",
      durationWeeks: 4,
      weeklyRateKg: 0.5,
      tdeeOverride: 2450,
    },
  ],
};

describe("offline start: cached Pro tier and phase target", () => {
  it("a Pro user opening the PWA offline keeps the 1,900 phase target", async () => {
    writeCachedTier("u1", "pro");
    fetchMock.mockImplementation(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    const fake = fakeAuthClient(SESSION);
    supabase.client = fake.client;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AiUsageProvider>{children}</AiUsageProvider>
    );
    const { result } = renderHook(() => useTargets(PROFILE, TODAY, TODAY), {
      wrapper,
    });

    await act(async () => fake.releaseGetUser(offlineGetUser));

    await waitFor(() => expect(result.current.phasesEnabled).toBe(true));
    expect(result.current.todayTargets.targetCalories).toBe(1900);
    expect(result.current.dayTargets.targetCalories).toBe(1900);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/billing/usage",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
