/** Promise-based bus that lets ANY part of the client request an
 *  MFA challenge from a single globally-mounted dialog.
 *
 *  Use case: an API call returns a 403 with `kind: "mfa-required"`.
 *  The fetch wrapper calls `requestMfaChallenge()` and awaits the
 *  promise. A globally-mounted `MfaChallengeDialog` (subscribed via
 *  `subscribeMfaChallenge`) opens, shows the TOTP input, runs
 *  `supabase.auth.mfa.challengeAndVerify`, and resolves the promise
 *  on success / rejects on cancel. The fetch wrapper then retries
 *  the original request — now with an AAL2 cookie — and the user
 *  never sees the underlying 403.
 *
 *  Two design choices worth documenting:
 *
 *  1. **Coalescing.** If a second fetch hits the wrapper while a
 *     challenge is already in flight, the second caller awaits the
 *     SAME promise. Only one dialog opens; both retries fire after
 *     the single verification succeeds. Without coalescing, three
 *     concurrent AI calls would stack three dialogs.
 *
 *  2. **No singleton state outside this module.** The bus is the
 *     module-level state; the dialog is the only subscriber.
 *     Components / hooks that need to wait don't import the
 *     dialog directly — they just call `requestMfaChallenge()`.
 *     This keeps the dependency graph one-way (bus → dialog,
 *     fetch → bus) and makes the unit tests trivial (no React
 *     mount needed). */

export type MfaChallengeResolver = {
  resolve: () => void;
  reject: (reason: "cancelled" | "failed") => void;
};

type MfaListener = (resolver: MfaChallengeResolver) => void;

let listener: MfaListener | null = null;
let pending: Promise<void> | null = null;
let pendingResolvers: MfaChallengeResolver | null = null;

/** Mount-side: register the function that opens the challenge UI.
 *  Pass an unmount cleanup via the returned `unsubscribe`. Calling
 *  `subscribe` while another listener is registered REPLACES the
 *  previous one — there is exactly one dialog in the app, and a
 *  hot-reload during dev should still result in one. */
export function subscribeMfaChallenge(fn: MfaListener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/** Caller-side: ask for an MFA challenge. Returns a promise that
 *  resolves when the user completes verification, rejects with
 *  `"cancelled"` when they dismiss the dialog, or `"failed"` if
 *  the dialog itself errored out (Supabase outage, network drop
 *  mid-verify). Concurrent calls share the same promise. */
export function requestMfaChallenge(): Promise<void> {
  if (pending) return pending;
  if (!listener) {
    // No dialog mounted yet (SSR pass, early in app boot, or a
    // page that doesn't render the global mount). Reject so the
    // caller falls back to whatever error UX they had before.
    return Promise.reject(new Error("MFA dialog not mounted."));
  }
  pending = new Promise<void>((resolve, reject) => {
    const resolver: MfaChallengeResolver = {
      resolve: () => {
        pending = null;
        pendingResolvers = null;
        resolve();
      },
      reject: (reason) => {
        pending = null;
        pendingResolvers = null;
        reject(new Error(`MFA challenge ${reason}`));
      },
    };
    // Hold the resolvers for tests + for `forceCloseMfaChallenge`.
    pendingResolvers = resolver;
    // Defer the listener call by one microtask so the awaiter of
    // `requestMfaChallenge()` registers its `.then`/`.catch`
    // handlers before resolve/reject can fire (e.g. on a unit
    // test where the listener is synchronous).
    queueMicrotask(() => {
      // The listener may have unmounted between the start of this
      // call and the queued tick — race during HMR or a page nav.
      // Reject so callers don't hang forever.
      if (!listener) {
        resolver.reject("failed");
        return;
      }
      listener(resolver);
    });
  });
  return pending;
}

/** Test / cleanup helper: tear down any in-flight challenge.
 *  Resolves the pending promise as cancelled. Useful in tests
 *  and on `signOut` where leaving a half-open challenge would
 *  confuse the next sign-in. */
export function forceCloseMfaChallenge(): void {
  pendingResolvers?.reject("cancelled");
  pending = null;
  pendingResolvers = null;
}

/** Test-only inspector — `null` when nothing is pending. */
export function _peekPending(): MfaChallengeResolver | null {
  return pendingResolvers;
}
