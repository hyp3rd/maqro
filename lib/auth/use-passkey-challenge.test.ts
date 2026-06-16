/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { usePasskeyChallenge } from "./use-passkey-challenge";

const { mockGetUser, mockSignInWithPasskey } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSignInWithPasskey: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => ({
    auth: { getUser: mockGetUser, signInWithPasskey: mockSignInWithPasskey },
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const user = (id: string | null) => ({ data: { user: id ? { id } : null } });

function setup() {
  const onVerified = vi.fn();
  const onBail = vi.fn();
  const { result } = renderHook(() =>
    usePasskeyChallenge({ onVerified, onBail }),
  );
  return { onVerified, onBail, result };
}

describe("usePasskeyChallenge", () => {
  it("resolves (onVerified) when the passkey is the SAME user", async () => {
    mockGetUser
      .mockResolvedValueOnce(user("alice")) // before
      .mockResolvedValueOnce(user("alice")); // after
    mockSignInWithPasskey.mockResolvedValue({ error: null });
    const { onVerified, onBail, result } = setup();
    await act(async () => {
      await result.current.run();
    });
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(onBail).not.toHaveBeenCalled();
  });

  it("bails (onBail), NOT onVerified, when the passkey resolves to a DIFFERENT user", async () => {
    // The account-switch footgun: a different account's discoverable credential
    // took over. The gated action must NOT run as that user.
    mockGetUser
      .mockResolvedValueOnce(user("alice")) // before
      .mockResolvedValueOnce(user("bob")); // after — wrong account!
    mockSignInWithPasskey.mockResolvedValue({ error: null });
    const { onVerified, onBail, result } = setup();
    await act(async () => {
      await result.current.run();
    });
    expect(onBail).toHaveBeenCalledTimes(1);
    expect(onVerified).not.toHaveBeenCalled();
  });

  it("bails when the post-ceremony session has no user", async () => {
    mockGetUser
      .mockResolvedValueOnce(user("alice"))
      .mockResolvedValueOnce(user(null));
    mockSignInWithPasskey.mockResolvedValue({ error: null });
    const { onVerified, onBail, result } = setup();
    await act(async () => {
      await result.current.run();
    });
    expect(onBail).toHaveBeenCalledTimes(1);
    expect(onVerified).not.toHaveBeenCalled();
  });

  it("surfaces a humanized error and leaves the session untouched on a ceremony failure", async () => {
    mockGetUser.mockResolvedValueOnce(user("alice")); // before only
    mockSignInWithPasskey.mockResolvedValue({
      error: new Error("challenge_expired"),
    });
    const { onVerified, onBail, result } = setup();
    await act(async () => {
      await result.current.run();
    });
    expect(onVerified).not.toHaveBeenCalled();
    expect(onBail).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/took too long/i);
    expect(result.current.busy).toBe(false); // re-enabled so they can retry
    expect(mockGetUser).toHaveBeenCalledTimes(1); // never read the "after" id
  });

  it("errors without running the ceremony when there's no current session", async () => {
    mockGetUser.mockResolvedValueOnce(user(null)); // before = null
    const { onVerified, onBail, result } = setup();
    await act(async () => {
      await result.current.run();
    });
    expect(mockSignInWithPasskey).not.toHaveBeenCalled();
    expect(onVerified).not.toHaveBeenCalled();
    expect(onBail).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/session expired/i);
  });
});
