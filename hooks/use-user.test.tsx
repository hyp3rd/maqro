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
 *  `initial` — preceded, with `initChain`, by the SIGNED_IN auth-js flushes
 *  from `_recoverAndRefresh` once it has initialized (the real order on a
 *  cold start); the first `getUser()` settles only when the test releases
 *  it, later ones answer `nextGetUser`; `emit` fires any later auth event to
 *  every subscriber. */
function fakeAuthClient(
  initial: Session | null,
  getSession: GetSessionResult = { data: { session: initial }, error: null },
  { initChain = false }: { initChain?: boolean } = {},
) {
  let releaseGetUser: (result: GetUserResult) => void = () => {};
  let failGetUser: (err: Error) => void = () => {};
  const getUserSettled = new Promise<GetUserResult>((resolve, reject) => {
    releaseGetUser = resolve;
    failGetUser = reject;
  });
  const state = {
    nextGetUser: null as GetUserResult | null,
    held: null as Promise<GetUserResult> | null,
    listeners: new Set<AuthListener>(),
  };
  const getUser = vi.fn(
    () =>
      state.held ??
      (state.nextGetUser === null
        ? getUserSettled
        : Promise.resolve(state.nextGetUser)),
  );
  const client = {
    auth: {
      getUser,
      getSession: () => Promise.resolve(getSession),
      onAuthStateChange: (callback: AuthListener) => {
        state.listeners.add(callback);
        queueMicrotask(() => {
          if (initChain && initial !== null) callback("SIGNED_IN", initial);
          callback("INITIAL_SESSION", initial);
        });
        return {
          data: {
            subscription: {
              unsubscribe: () => state.listeners.delete(callback),
            },
          },
        };
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
    /** Hold every later `getUser()` until the returned function answers
     *  them all with `result`. */
    holdGetUser: () => {
      let answer: (result: GetUserResult) => void = () => {};
      state.held = new Promise<GetUserResult>((resolve) => {
        answer = resolve;
      });
      return (result: GetUserResult) =>
        act(async () => {
          state.held = null;
          answer(result);
        });
    },
    emit: (event: AuthChangeEvent, session: Session | null) =>
      act(() => {
        for (const listener of [...state.listeners]) listener(event, session);
      }),
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
  vi.restoreAllMocks(); // the `document.visibilityState` spy
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

/** Renders two mounted `useUser` instances sharing one fake client (the app
 *  mounts ~15), with the real cold-start order of auth events, and waits
 *  for INITIAL_SESSION. */
async function startTwoInstances(
  persisted: Session,
  getSession?: GetSessionResult,
) {
  const fake = fakeAuthClient(persisted, getSession, { initChain: true });
  supabase.client = fake.client;
  const hook = renderHook(() => [useUser(), useUser()]);
  await waitFor(() =>
    expect(hook.result.current.every((s) => s.user === persisted.user)).toBe(
      true,
    ),
  );
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

function changeVisibility(state: DocumentVisibilityState) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
  return act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

const becomeVisible = () => changeVisibility("visible");

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
    const { result, releaseGetUser, emit, answerGetUserWith, getUser } =
      await startWith(SESSION);
    const other = { id: "u2" } as User;
    // The new session is checked in turn; the server answers for it.
    answerGetUserWith({ data: { user: other }, error: null });
    emit("SIGNED_IN", { user: other } as Session);
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () =>
      releaseGetUser({ data: { user: USER }, error: null }),
    );
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(result.current.user).toBe(other);
    expect(readLastKnownUserId()).toBe("u2");
  });
});

/** auth-js emits SIGNED_IN with the STORED session while the client
 *  initializes (`_recoverAndRefresh`, flushed once `initializePromise`
 *  settles) and again whenever the tab becomes visible — without asking the
 *  server. `getUser()` waits for that same `initializePromise`, so this
 *  SIGNED_IN routinely lands before the `/auth/v1/user` answer. It must not
 *  stand in for that answer. */
describe("useUser — SIGNED_IN from storage is still checked with the server", () => {
  /** A banned or deleted user: the access token still parses, the server
   *  refuses it. */
  const bannedGetUser: GetUserResult = {
    data: { user: null },
    error: new AuthApiError("User is banned", 403, "user_banned"),
  };

  it("a rejected session ends signed out and forgotten although SIGNED_IN came first", async () => {
    writeLastKnownUserId("u1");
    const { result, releaseGetUser, emit, getUser } = await startWith(SESSION);
    emit("SIGNED_IN", SESSION);

    await act(async () => releaseGetUser(bannedGetUser));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.user).toBeNull();
    expect(result.current.localUserId).toBeNull();
    expect(readLastKnownUserId()).toBeNull();
    // The check in flight was for that same session, so it decided alone.
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it("offline cold start with an unexpired token stays unverified, and 'online' verifies it", async () => {
    const { result, releaseGetUser, emit, answerGetUserWith, getUser } =
      await startWith(SESSION);
    emit("SIGNED_IN", SESSION);
    await act(async () => releaseGetUser(offlineGetUser));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.user).toBe(USER);
    expect(getUser).toHaveBeenCalledTimes(1);

    const verified = { id: "u1", email: "a@example.com" } as User;
    answerGetUserWith({ data: { user: verified }, error: null });
    await goOnline();
    await waitFor(() => expect(result.current.user).toBe(verified));
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it("offline cold start with an unexpired token is verified when the tab becomes visible", async () => {
    const { result, releaseGetUser, emit, answerGetUserWith, getUser } =
      await startWith(SESSION);
    emit("SIGNED_IN", SESSION);
    await act(async () => releaseGetUser(offlineGetUser));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    const verified = { id: "u1", email: "a@example.com" } as User;
    answerGetUserWith({ data: { user: verified }, error: null });
    await becomeVisible();
    await waitFor(() => expect(result.current.user).toBe(verified));
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(readLastKnownUserId()).toBe("u1");
  });

  it("a session the server refused is checked again when SIGNED_IN re-delivers it, and never shown or recorded meanwhile", async () => {
    // auth-js keeps a session that `/auth/v1/user` refused with anything but
    // "session missing", and re-emits it as SIGNED_IN on the next tab focus.
    const { result, releaseGetUser, emit, getUser, holdGetUser } =
      await startWith(SESSION);
    await act(async () => releaseGetUser(bannedGetUser));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.user).toBeNull();

    const answer = holdGetUser();
    emit("SIGNED_IN", SESSION);
    expect(getUser).toHaveBeenCalledTimes(2);
    // Still refused as far as anyone knows: nothing keyed to the account
    // (sync, AI, billing) may start, and the offline fallback stays empty.
    expect(result.current.user).toBeNull();
    expect(result.current.localUserId).toBeNull();
    expect(readLastKnownUserId()).toBeNull();

    await answer(bannedGetUser);
    expect(result.current.user).toBeNull();
    expect(readLastKnownUserId()).toBeNull();
  });

  it("a refused session the server accepts later is shown and recorded", async () => {
    const { result, releaseGetUser, emit, answerGetUserWith } =
      await startWith(SESSION);
    await act(async () => releaseGetUser(bannedGetUser));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    answerGetUserWith({ data: { user: USER }, error: null });
    emit("SIGNED_IN", SESSION);
    await waitFor(() => expect(result.current.user).toBe(USER));
    expect(readLastKnownUserId()).toBe("u1");
  });

  it("a refused account signing in afresh after a sign-out is shown while checked", async () => {
    const { result, releaseGetUser, emit, holdGetUser } =
      await startWith(SESSION);
    await act(async () => releaseGetUser(bannedGetUser));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    // The refused session is gone; a new sign-in is a new session.
    emit("SIGNED_OUT", null);
    const answer = holdGetUser();
    emit("SIGNED_IN", SESSION);
    expect(result.current.user).toBe(USER);
    expect(readLastKnownUserId()).toBeNull();
    await answer({ data: { user: USER }, error: null });
    expect(readLastKnownUserId()).toBe("u1");
  });

  it("a refused session that can't be checked offline stays hidden", async () => {
    const { result, releaseGetUser, emit, answerGetUserWith, getUser } =
      await startWith(SESSION);
    await act(async () => releaseGetUser(bannedGetUser));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    // getSession() still returns the stored (refused) session offline.
    answerGetUserWith(offlineGetUser);
    emit("SIGNED_IN", SESSION);
    await waitFor(() => expect(getUser).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(result.current.user).toBeNull();
    expect(result.current.localUserId).toBeNull();
    expect(readLastKnownUserId()).toBeNull();

    // … and is checked again once that could succeed.
    answerGetUserWith(bannedGetUser);
    await goOnline();
    expect(getUser).toHaveBeenCalledTimes(3);
    expect(result.current.user).toBeNull();
  });

  it("a SIGNED_IN before the first answer shows the session but does not record it", async () => {
    const { result, releaseGetUser, emit } = await startWith(SESSION);
    emit("SIGNED_IN", SESSION);
    // Provisional: shown at once, but nothing the server confirmed yet, so
    // the last-known record (the offline fallback) is not written from it.
    expect(result.current.user).toBe(USER);
    expect(readLastKnownUserId()).toBeNull();

    await act(async () => releaseGetUser(bannedGetUser));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.user).toBeNull();
    expect(readLastKnownUserId()).toBeNull();
  });

  it("a repeated SIGNED_IN for the account being checked leaves the verdict to that check", async () => {
    const { result, releaseGetUser, emit, getUser, holdGetUser } =
      await startWith(SESSION);
    await act(async () =>
      releaseGetUser({ data: { user: USER }, error: null }),
    );
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    // Signing in as u2 starts a check of u2 that has not answered yet …
    const other = { id: "u2" } as User;
    const answer = holdGetUser();
    emit("SIGNED_IN", { user: other } as Session);
    expect(getUser).toHaveBeenCalledTimes(2);

    // … when u2's session is delivered again (tab focus). The check in
    // flight already asks about it: no second request, and its answer —
    // here, refused — is not thrown away.
    emit("SIGNED_IN", { user: other } as Session);
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(result.current.user).toBe(other);

    await answer(bannedGetUser);
    expect(result.current.user).toBeNull();
    expect(readLastKnownUserId()).toBeNull();
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it("an answer about another account than the session being checked is asked again", async () => {
    // The check read the stored session at a moment this hook can't see:
    // an answer naming another account than the session it was told about
    // may be the older one, so it is never applied as is.
    const { result, releaseGetUser, answerGetUserWith, getUser } =
      await startWith(SESSION);
    const other = { id: "u2" } as User;
    answerGetUserWith({ data: { user: USER }, error: null });
    await act(async () =>
      releaseGetUser({ data: { user: other }, error: null }),
    );
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(result.current.user).toBe(USER);
    expect(readLastKnownUserId()).toBe("u1");
  });

  it("an unverified session re-delivered by SIGNED_IN is checked with the server", async () => {
    // Resolved offline with an unexpired token: shown, but never verified.
    // Another tab then broadcasts the same session with no check in flight
    // here — that is still no verdict from the server, so it is asked.
    writeLastKnownUserId("u1");
    const { result, releaseGetUser, emit, answerGetUserWith, getUser } =
      await startWith(SESSION);
    await act(async () => releaseGetUser(offlineGetUser));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.user).toBe(USER);
    expect(getUser).toHaveBeenCalledTimes(1);

    answerGetUserWith(bannedGetUser);
    emit("SIGNED_IN", SESSION);
    await waitFor(() => expect(getUser).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.user).toBeNull());
    expect(readLastKnownUserId()).toBeNull();
  });

  it.each(["TOKEN_REFRESHED", "USER_UPDATED"] as const)(
    "%s carries a session the server just issued: it verifies without another check",
    async (event) => {
      const { result, releaseGetUser, emit, getUser } =
        await startWith(SESSION);
      await act(async () => releaseGetUser(offlineGetUser));
      await waitFor(() => expect(result.current.isLoaded).toBe(true));

      emit(event, SESSION);
      expect(result.current.user).toBe(USER);
      expect(readLastKnownUserId()).toBe("u1");
      // Verified: neither the event nor a later 'online' asks the server.
      await goOnline();
      expect(getUser).toHaveBeenCalledTimes(1);
    },
  );

  it("a verified session re-delivered on tab focus is not checked again", async () => {
    const { result, releaseGetUser, emit, getUser } = await startWith(SESSION);
    await act(async () =>
      releaseGetUser({ data: { user: USER }, error: null }),
    );
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    emit("SIGNED_IN", SESSION);
    expect(result.current.user).toBe(USER);
    expect(getUser).toHaveBeenCalledTimes(1);
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

  it("is checked again when the tab becomes visible", async () => {
    const { result, failGetUser, answerGetUserWith } = await startWith(SESSION);
    await act(async () => failGetUser(new Error("storage failed")));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    answerGetUserWith({ data: { user: USER }, error: null });
    await becomeVisible();
    await waitFor(() => expect(result.current.user).toBe(USER));
  });

  it("a tab turning hidden does not check again", async () => {
    const { result, failGetUser, answerGetUserWith, getUser } =
      await startWith(SESSION);
    await act(async () => failGetUser(new Error("storage failed")));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    answerGetUserWith({ data: { user: USER }, error: null });
    await changeVisibility("hidden");
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(result.current.user).toBeNull();
  });

  it("a verified identity is not checked again when the tab becomes visible", async () => {
    const { result, releaseGetUser, getUser } = await startWith(SESSION);
    await act(async () =>
      releaseGetUser({ data: { user: USER }, error: null }),
    );
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await becomeVisible();
    expect(getUser).toHaveBeenCalledTimes(1);
  });
});

describe("useUser — account switch", () => {
  it("signing in as another account replaces the record once the server verified it", async () => {
    const { result, releaseGetUser, emit, holdGetUser } =
      await startWith(SESSION);
    await act(async () =>
      releaseGetUser({ data: { user: USER }, error: null }),
    );
    await waitFor(() => expect(readLastKnownUserId()).toBe("u1"));

    const other = { id: "u2" } as User;
    const answer = holdGetUser();
    emit("SIGNED_IN", { user: other } as Session);
    // Shown at once (it is the current session), recorded only once verified.
    expect(result.current.user).toBe(other);
    expect(readLastKnownUserId()).toBe("u1");

    await answer({ data: { user: other }, error: null });
    expect(result.current.user).toBe(other);
    expect(readLastKnownUserId()).toBe("u2");
  });
});

/** Every mounted `useUser` checks the identity on its own (~15 of them in
 *  the app), and auth-js's init-chain SIGNED_IN reaches each one while that
 *  check is in flight. A check costs a `/auth/v1/user` round trip, so each
 *  instance asks once per cold start or re-check. */
describe("useUser — one identity check per instance", () => {
  it("a normal cold start asks the server once per instance", async () => {
    const { result, releaseGetUser, getUser } =
      await startTwoInstances(SESSION);
    await act(async () =>
      releaseGetUser({ data: { user: USER }, error: null }),
    );
    await waitFor(() =>
      expect(result.current.every((s) => s.isLoaded)).toBe(true),
    );
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(result.current.map((s) => s.user)).toEqual([USER, USER]);
    expect(readLastKnownUserId()).toBe("u1");
  });

  it("a banned user's cold start asks once per instance and ends signed out", async () => {
    writeLastKnownUserId("u1");
    const { result, releaseGetUser, getUser } =
      await startTwoInstances(SESSION);
    await act(async () =>
      releaseGetUser({
        data: { user: null },
        error: new AuthApiError("User is banned", 403, "user_banned"),
      }),
    );
    await waitFor(() =>
      expect(result.current.every((s) => s.isLoaded)).toBe(true),
    );
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(result.current.map((s) => s.user)).toEqual([null, null]);
    expect(readLastKnownUserId()).toBeNull();
  });

  it.each([
    ["before", true],
    ["after", false],
  ] as const)(
    "a tab-visible re-check asks once per instance (SIGNED_IN %s the visibility handler)",
    async (_order, signedInFirst) => {
      const { result, releaseGetUser, emit, holdGetUser, getUser } =
        await startTwoInstances(SESSION);
      await act(async () => releaseGetUser(offlineGetUser));
      await waitFor(() =>
        expect(result.current.every((s) => s.isLoaded)).toBe(true),
      );
      expect(getUser).toHaveBeenCalledTimes(2);

      // On focus auth-js re-emits the stored session (_recoverAndRefresh)
      // while each instance re-checks its unverified identity.
      const answer = holdGetUser();
      if (signedInFirst) emit("SIGNED_IN", SESSION);
      await becomeVisible();
      if (!signedInFirst) emit("SIGNED_IN", SESSION);
      expect(getUser).toHaveBeenCalledTimes(4);

      const verified = { id: "u1", email: "a@example.com" } as User;
      await answer({ data: { user: verified }, error: null });
      expect(result.current.map((s) => s.user)).toEqual([verified, verified]);
      expect(getUser).toHaveBeenCalledTimes(4);
    },
  );

  it("an 'online' event during a re-check that then fails offline checks again", async () => {
    const { result, releaseGetUser, holdGetUser, answerGetUserWith, getUser } =
      await startWith(SESSION);
    await act(async () => releaseGetUser(offlineGetUser));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    const answer = holdGetUser();
    await becomeVisible();
    expect(getUser).toHaveBeenCalledTimes(2);
    // The network returns while that check is still out; it is not asked
    // twice at once, but its failure does not swallow the 'online' event.
    await goOnline();
    expect(getUser).toHaveBeenCalledTimes(2);
    answerGetUserWith({ data: { user: USER }, error: null });
    await answer(offlineGetUser);
    await waitFor(() => expect(getUser).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(readLastKnownUserId()).toBe("u1"));
    expect(result.current.user).toBe(USER);
  });

  it("another tab's sign-out during a re-check is not undone by its answer", async () => {
    const { result, releaseGetUser, emit, holdGetUser } =
      await startWith(SESSION);
    await act(async () => releaseGetUser(offlineGetUser));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    const answer = holdGetUser();
    await becomeVisible();
    emit("SIGNED_IN", SESSION);
    emit("SIGNED_OUT", null);
    await answer({ data: { user: USER }, error: null });
    expect(result.current.user).toBeNull();
    expect(readLastKnownUserId()).toBeNull();
  });
});

/** The last-known record is the offline fallback's only identity, so only a
 *  session the server has vouched for may write it. */
describe("useUser — only a verified session is recorded", () => {
  it("a session resolved offline is shown but not recorded", async () => {
    const { result, releaseGetUser } = await startWith(SESSION);
    await act(async () => releaseGetUser(offlineGetUser));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.user).toBe(USER);
    expect(readLastKnownUserId()).toBeNull();
  });

  it("after a thrown check, SIGNED_IN shows the session provisionally and records it only once verified", async () => {
    const { result, failGetUser, emit, holdGetUser } = await startWith(SESSION);
    await act(async () => failGetUser(new Error("storage failed")));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    const answer = holdGetUser();
    emit("SIGNED_IN", SESSION);
    expect(result.current.user).toBe(USER);
    expect(readLastKnownUserId()).toBeNull();

    await answer({ data: { user: USER }, error: null });
    expect(readLastKnownUserId()).toBe("u1");
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
