/**
 * @vitest-environment jsdom
 */
import {
  readLastKnownUserId,
  writeLastKnownUserId,
} from "@/lib/auth/last-known-user";
import { writeCachedTier } from "@/lib/billing/tier-cache";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersonalInfo } from "@maqro/core/types";
import {
  AuthApiError,
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
 *  "couldn't ask the server", not "signed out".
 *
 *  Once the access token has expired too, auth-js cannot refresh it offline:
 *  INITIAL_SESSION delivers `null`, and both `getUser()` and `getSession()`
 *  report no session with an `AuthRetryableFetchError` (the stored session
 *  is kept for a refresh once the network is back). */

type GetUserResult = { data: { user: User | null }; error: AuthError | null };
type GetSessionResult = {
  data: { session: Session | null };
  error: AuthError | null;
};
type AuthListener = (event: AuthChangeEvent, session: Session | null) => void;

/** A stand-in for the browser auth client. INITIAL_SESSION fires first with
 *  `initial`; the first `getUser()` settles only when the test releases it,
 *  later ones answer `nextGetUser`; `emit` fires any later auth event. */
function fakeAuthClient(
  initial: Session | null,
  getSession: GetSessionResult = { data: { session: initial }, error: null },
) {
  let releaseGetUser: (result: GetUserResult) => void = () => {};
  let failGetUser: (err: Error) => void = () => {};
  const getUserSettled = new Promise<GetUserResult>((resolve, reject) => {
    releaseGetUser = resolve;
    failGetUser = reject;
  });
  const state = {
    nextGetUser: null as GetUserResult | null,
    listener: null as AuthListener | null,
  };
  const getUser = vi.fn(() =>
    state.nextGetUser === null
      ? getUserSettled
      : Promise.resolve(state.nextGetUser),
  );
  const client = {
    auth: {
      getUser,
      getSession: () => Promise.resolve(getSession),
      onAuthStateChange: (callback: AuthListener) => {
        state.listener = callback;
        queueMicrotask(() => callback("INITIAL_SESSION", initial));
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  };
  return {
    client,
    getUser,
    releaseGetUser,
    /** Make the first `getUser()` throw instead of returning an error. */
    failGetUser,
    /** Answer every later `getUser()` (an `online` re-check) with `result`. */
    answerGetUserWith: (result: GetUserResult) => {
      state.nextGetUser = result;
    },
    emit: (event: AuthChangeEvent, session: Session | null) =>
      act(() => state.listener?.(event, session)),
  };
}

const supabase = vi.hoisted(() => ({
  client: null as unknown,
  /** The user id of the session auth-js keeps in storage (see
   *  lib/supabase/stored-session.ts), or `null` for none. */
  storedSessionUserId: null as string | null,
}));
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => supabase.client,
  readStoredSessionUserId: () => Promise.resolve(supabase.storedSessionUserId),
}));
const reportClientError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/error-reporter", () => ({ reportClientError }));

const USER = { id: "u1" } as User;
const SESSION = { user: USER } as Session;
const networkError = () => new AuthRetryableFetchError("Failed to fetch", 0);
const offlineGetUser: GetUserResult = {
  data: { user: null },
  error: networkError(),
};
/** `getSession()` offline with an expired access token: the refresh failed
 *  for lack of network, so there is no usable session. */
const expiredOfflineSession: GetSessionResult = {
  data: { session: null },
  error: networkError(),
};
/** The server rejected the stored refresh token (revoked session). */
const revokedGetUser: GetUserResult = {
  data: { user: null },
  error: new AuthApiError(
    "Invalid Refresh Token: Refresh Token Not Found",
    400,
    "refresh_token_not_found",
  ),
};

const fetchMock =
  vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  window.localStorage.clear();
  supabase.storedSessionUserId = null;
  reportClientError.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Renders `useUser` against a fake client and waits for INITIAL_SESSION. */
async function startWith(
  persisted: Session | null,
  getSession?: GetSessionResult,
) {
  const fake = fakeAuthClient(persisted, getSession);
  supabase.client = fake.client;
  const hook = renderHook(() => useUser());
  await waitFor(() =>
    expect(hook.result.current.user).toBe(persisted?.user ?? null),
  );
  expect(hook.result.current.isLoaded).toBe(false);
  return { ...hook, ...fake };
}

/** Opened offline after u1's access token expired (the expired session is
 *  still stored), with `u1` recorded. */
async function startExpiredOffline() {
  writeLastKnownUserId("u1");
  supabase.storedSessionUserId = "u1";
  const started = await startWith(null, expiredOfflineSession);
  await act(async () => started.releaseGetUser(offlineGetUser));
  await waitFor(() => expect(started.result.current.isLoaded).toBe(true));
  return started;
}

function goOnline() {
  return act(async () => {
    window.dispatchEvent(new Event("online"));
  });
}

describe("useUser", () => {
  it("offline: a network failure keeps the persisted session's user", async () => {
    const { result, releaseGetUser } = await startWith(SESSION);
    await act(async () => releaseGetUser(offlineGetUser));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.user).toBe(USER);
    expect(result.current.localUserId).toBe("u1");
    expect(result.current.isOfflineUnverified).toBe(false);
  });

  it("offline with no stored session: signed out", async () => {
    writeLastKnownUserId("u1");
    const { result, releaseGetUser } = await startWith(null);
    await act(async () => releaseGetUser(offlineGetUser));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.user).toBeNull();
    expect(result.current.localUserId).toBeNull();
    expect(readLastKnownUserId()).toBeNull();
  });

  it("a session the server rejects still signs out, and forgets the user", async () => {
    writeLastKnownUserId("u1");
    const { result, releaseGetUser } = await startWith(SESSION);
    await act(async () =>
      releaseGetUser({
        data: { user: null },
        error: new AuthSessionMissingError(),
      }),
    );
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.user).toBeNull();
    expect(result.current.localUserId).toBeNull();
    expect(readLastKnownUserId()).toBeNull();
  });

  it("online: the server-verified user wins, and is recorded", async () => {
    const verified = { id: "u1", email: "a@example.com" } as User;
    const { result, releaseGetUser } = await startWith(SESSION);
    await act(async () =>
      releaseGetUser({ data: { user: verified }, error: null }),
    );
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.user).toBe(verified);
    expect(readLastKnownUserId()).toBe("u1");
  });

  it("unconfigured: loaded at once, no user", () => {
    supabase.client = null;
    const { result } = renderHook(() => useUser());
    expect(result.current).toEqual({
      user: null,
      localUserId: null,
      isOfflineUnverified: false,
      isLoaded: true,
      isUnconfigured: true,
    });
  });
});

describe("useUser — offline open after the access token expired", () => {
  it("keeps the last-known user, explicitly unverified and without a session", async () => {
    const { result } = await startExpiredOffline();
    expect(result.current.user).toBeNull();
    expect(result.current.localUserId).toBe("u1");
    expect(result.current.isOfflineUnverified).toBe(true);
    expect(readLastKnownUserId()).toBe("u1");
  });

  it("with nothing recorded: signed out", async () => {
    const { result, releaseGetUser } = await startWith(
      null,
      expiredOfflineSession,
    );
    await act(async () => releaseGetUser(offlineGetUser));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.localUserId).toBeNull();
    expect(result.current.isOfflineUnverified).toBe(false);
  });

  it("a record naming another account than the stored session is ignored and cleared", async () => {
    // An older bundle (mid service-worker rollover) signed u1 out and u2 in
    // without updating the record, then u2's token expired offline.
    writeLastKnownUserId("u1");
    supabase.storedSessionUserId = "u2";
    const { result, releaseGetUser } = await startWith(
      null,
      expiredOfflineSession,
    );
    await act(async () => releaseGetUser(offlineGetUser));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.localUserId).toBeNull();
    expect(result.current.isOfflineUnverified).toBe(false);
    expect(readLastKnownUserId()).toBeNull();
  });

  it("with no readable stored session the record is not used", async () => {
    writeLastKnownUserId("u1");
    const { result, releaseGetUser } = await startWith(
      null,
      expiredOfflineSession,
    );
    await act(async () => releaseGetUser(offlineGetUser));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.localUserId).toBeNull();
    expect(result.current.isOfflineUnverified).toBe(false);
    expect(readLastKnownUserId()).toBeNull();
  });

  it("a late INITIAL_SESSION(null) does not undo the resolved state", async () => {
    const { result, emit } = await startExpiredOffline();
    emit("INITIAL_SESSION", null);
    expect(result.current.localUserId).toBe("u1");
    expect(result.current.isOfflineUnverified).toBe(true);
  });

  it("back online with a revoked session: signed out and the record cleared", async () => {
    const { result, answerGetUserWith, getUser } = await startExpiredOffline();
    answerGetUserWith(revokedGetUser);
    await goOnline();
    await waitFor(() => expect(result.current.localUserId).toBeNull());
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(result.current.user).toBeNull();
    expect(result.current.isOfflineUnverified).toBe(false);
    expect(readLastKnownUserId()).toBeNull();
  });

  it("back online with a valid session: verified", async () => {
    const { result, answerGetUserWith } = await startExpiredOffline();
    answerGetUserWith({ data: { user: USER }, error: null });
    await goOnline();
    await waitFor(() => expect(result.current.user).toBe(USER));
    expect(result.current.isOfflineUnverified).toBe(false);
    expect(readLastKnownUserId()).toBe("u1");
  });

  it("an 'online' event while the server is still unreachable changes nothing", async () => {
    const { result, answerGetUserWith } = await startExpiredOffline();
    answerGetUserWith(offlineGetUser);
    await goOnline();
    expect(result.current.isOfflineUnverified).toBe(true);
    expect(readLastKnownUserId()).toBe("u1");
  });

  it("the server rejecting the refresh (SIGNED_OUT) clears the record", async () => {
    const { result, emit } = await startExpiredOffline();
    emit("SIGNED_OUT", null);
    expect(result.current.localUserId).toBeNull();
    expect(result.current.isOfflineUnverified).toBe(false);
    expect(readLastKnownUserId()).toBeNull();
  });

  it("a refresh that succeeds once the network is back verifies the session", async () => {
    const { result, emit } = await startExpiredOffline();
    emit("TOKEN_REFRESHED", SESSION);
    expect(result.current.user).toBe(USER);
    expect(result.current.isOfflineUnverified).toBe(false);
  });

  it("a verified session never re-checks on 'online'", async () => {
    const { result, releaseGetUser, getUser } = await startWith(SESSION);
    await act(async () =>
      releaseGetUser({ data: { user: USER }, error: null }),
    );
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    await goOnline();
    expect(getUser).toHaveBeenCalledTimes(1);
  });
});

describe("useUser — an auth event supersedes a check still in flight", () => {
  it("another tab's sign-out is not undone by the late answer", async () => {
    writeLastKnownUserId("u1");
    const { result, releaseGetUser, emit } = await startWith(SESSION);
    emit("SIGNED_OUT", null);
    expect(result.current.user).toBeNull();
    expect(result.current.isLoaded).toBe(true);
    expect(readLastKnownUserId()).toBeNull();

    // The server answered before the sign-out; that answer is stale now.
    await act(async () =>
      releaseGetUser({ data: { user: USER }, error: null }),
    );
    expect(result.current.user).toBeNull();
    expect(result.current.localUserId).toBeNull();
    expect(readLastKnownUserId()).toBeNull();
  });

  it("a sign-in as another account is not undone by the late answer", async () => {
    const { result, releaseGetUser, emit } = await startWith(SESSION);
    const other = { id: "u2" } as User;
    emit("SIGNED_IN", { user: other } as Session);

    await act(async () =>
      releaseGetUser({ data: { user: USER }, error: null }),
    );
    expect(result.current.user).toBe(other);
    expect(result.current.isLoaded).toBe(true);
    expect(readLastKnownUserId()).toBe("u2");
  });
});

describe("useUser — the identity check throws", () => {
  it("settles signed out and loaded, reports the error, and keeps the record", async () => {
    writeLastKnownUserId("u1");
    const { result, failGetUser } = await startWith(SESSION);
    const storageError = new DOMException("blocked", "SecurityError");
    await act(async () => failGetUser(storageError));

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.user).toBeNull();
    expect(result.current.localUserId).toBeNull();
    expect(result.current.isOfflineUnverified).toBe(false);
    expect(reportClientError).toHaveBeenCalledWith(
      storageError,
      expect.anything(),
    );
    // Nothing said the session is gone: the record is not the check's to drop.
    expect(readLastKnownUserId()).toBe("u1");
  });

  it("is checked again when the network returns", async () => {
    const { result, failGetUser, answerGetUserWith } = await startWith(SESSION);
    await act(async () => failGetUser(new Error("storage failed")));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    answerGetUserWith({ data: { user: USER }, error: null });
    await goOnline();
    await waitFor(() => expect(result.current.user).toBe(USER));
  });
});

describe("useUser — account switch", () => {
  it("signing in as another account replaces the record", async () => {
    const { result, releaseGetUser, emit } = await startWith(SESSION);
    await act(async () =>
      releaseGetUser({ data: { user: USER }, error: null }),
    );
    await waitFor(() => expect(readLastKnownUserId()).toBe("u1"));

    const other = { id: "u2" } as User;
    emit("SIGNED_IN", { user: other } as Session);
    expect(result.current.user).toBe(other);
    expect(readLastKnownUserId()).toBe("u2");
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

function aiUsageWrapper({ children }: { children: ReactNode }) {
  return <AiUsageProvider>{children}</AiUsageProvider>;
}

describe("offline start: cached Pro tier and phase target", () => {
  it("a Pro user opening the PWA offline keeps the 1,900 phase target", async () => {
    writeCachedTier("u1", "pro");
    fetchMock.mockImplementation(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    const fake = fakeAuthClient(SESSION);
    supabase.client = fake.client;
    const { result } = renderHook(() => useTargets(PROFILE, TODAY, TODAY), {
      wrapper: aiUsageWrapper,
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

  it("after the access token expired, the last-known user keeps the 1,900 target without calling the server", async () => {
    writeCachedTier("u1", "pro");
    writeLastKnownUserId("u1");
    supabase.storedSessionUserId = "u1";
    const fake = fakeAuthClient(null, expiredOfflineSession);
    supabase.client = fake.client;
    const { result } = renderHook(() => useTargets(PROFILE, TODAY, TODAY), {
      wrapper: aiUsageWrapper,
    });

    await act(async () => fake.releaseGetUser(offlineGetUser));

    await waitFor(() => expect(result.current.phasesEnabled).toBe(true));
    expect(result.current.todayTargets.targetCalories).toBe(1900);
    expect(result.current.dayTargets.targetCalories).toBe(1900);
    // The record is not a credential: no usage request is made as u1.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
