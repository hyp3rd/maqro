import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _peekPending,
  forceCloseMfaChallenge,
  requestMfaChallenge,
  subscribeMfaChallenge,
} from "./mfa-challenge-bus";

afterEach(() => {
  forceCloseMfaChallenge();
});

describe("mfa-challenge-bus", () => {
  it("rejects when no listener is subscribed", async () => {
    await expect(requestMfaChallenge()).rejects.toThrow(
      "MFA dialog not mounted.",
    );
  });

  it("invokes the listener with a resolver that settles the promise", async () => {
    const listener = vi.fn((resolver: { resolve: () => void }) => {
      resolver.resolve();
    });
    const unsubscribe = subscribeMfaChallenge(listener);

    await expect(requestMfaChallenge()).resolves.toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(_peekPending()).toBeNull();

    unsubscribe();
  });

  it("rejects with the supplied reason on cancel", async () => {
    const unsubscribe = subscribeMfaChallenge((resolver) => {
      resolver.reject("cancelled");
    });

    await expect(requestMfaChallenge()).rejects.toThrow(
      "MFA challenge cancelled",
    );
    expect(_peekPending()).toBeNull();

    unsubscribe();
  });

  it("coalesces concurrent callers onto a single in-flight challenge", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMfaChallenge(listener);

    const a = requestMfaChallenge();
    const b = requestMfaChallenge();
    // Microtask ticks so the deferred listener call runs.
    await Promise.resolve();
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);
    const resolver = listener.mock.calls[0]?.[0] as { resolve: () => void };
    resolver.resolve();

    await expect(a).resolves.toBeUndefined();
    await expect(b).resolves.toBeUndefined();

    unsubscribe();
  });

  it("allows a fresh challenge after the previous one settles", async () => {
    const listener = vi.fn((resolver: { resolve: () => void }) => {
      resolver.resolve();
    });
    const unsubscribe = subscribeMfaChallenge(listener);

    await requestMfaChallenge();
    await requestMfaChallenge();

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("forceCloseMfaChallenge rejects the pending promise as cancelled", async () => {
    const unsubscribe = subscribeMfaChallenge(() => {
      // never settle — simulate user hanging on the dialog
    });

    const pending = requestMfaChallenge();
    // Drain the queued microtask that invokes the listener.
    await Promise.resolve();
    forceCloseMfaChallenge();

    await expect(pending).rejects.toThrow("MFA challenge cancelled");
    expect(_peekPending()).toBeNull();

    unsubscribe();
  });

  it("rejects if the listener unsubscribes between request and dispatch", async () => {
    const unsubscribe = subscribeMfaChallenge(() => {
      throw new Error("listener should not run");
    });

    const pending = requestMfaChallenge();
    unsubscribe();

    await expect(pending).rejects.toThrow("MFA challenge failed");
  });
});
