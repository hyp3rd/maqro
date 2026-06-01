/**
 * @vitest-environment jsdom
 */
import {
  forceCloseMfaChallenge,
  requestMfaChallenge,
} from "@/lib/auth/mfa-challenge-bus";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

/** Behaviour tests for the global MFA challenge dialog.
 *
 *  The bus + clientFetch already have isolated unit tests; this file
 *  exercises the dialog itself — the React state machine that the
 *  unit tests can't see:
 *
 *    - On bus dispatch: looks up factors, opens iff a verified TOTP
 *      factor exists, rejects iff Supabase is missing / outage.
 *    - On verify: gates the 6-digit input shape, calls
 *      challengeAndVerify, resolves the awaiter on success, surfaces
 *      the error on failure without leaking the dialog open.
 *    - On cancel: rejects the awaiter as "cancelled" and dismisses
 *      the dialog.
 *
 *  All Supabase calls are mocked — same pattern as
 *  [components/macro/MfaSection.test.tsx](../macro/MfaSection.test.tsx).
 *  We're testing OUR state machine, not Supabase's MFA backend. */

const VERIFIED_FACTOR_ID = "factor-verified";

const mockListFactors = vi.hoisted(() => vi.fn());
const mockChallengeAndVerify = vi.hoisted(() => vi.fn());
const mockGetSupabaseBrowser = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: mockGetSupabaseBrowser,
}));

function fakeSupabase() {
  return {
    auth: {
      mfa: {
        listFactors: mockListFactors,
        challengeAndVerify: mockChallengeAndVerify,
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSupabaseBrowser.mockReturnValue(fakeSupabase());
  mockListFactors.mockResolvedValue({
    data: { totp: [{ id: VERIFIED_FACTOR_ID, status: "verified" }], all: [] },
    error: null,
  });
});

afterEach(() => {
  // Drain any in-flight bus state before the next test stamps over it.
  // Without this, a test that opens the dialog but never settles the
  // promise leaks state into the next test's listener.
  forceCloseMfaChallenge();
  cleanup();
});

describe("MfaChallengeDialog - bus dispatch", () => {
  it("opens when a verified TOTP factor is found", async () => {
    const { MfaChallengeDialog } = await import("./MfaChallengeDialog");
    render(<MfaChallengeDialog />);

    // Fire the bus while the dialog is mounted. We don't await the
    // returned promise — it only resolves on verify, which happens
    // later in the verify-success test.
    // Swallow rejection from afterEach's forceCloseMfaChallenge —
    // the test isn't asserting on this promise; without the catch
    // Node logs an unhandled-rejection and fails the run.
    requestMfaChallenge().catch(() => {});

    await waitFor(() => {
      expect(screen.queryByText(/verify your second factor/i)).not.toBeNull();
    });
    expect(mockListFactors).toHaveBeenCalledTimes(1);
  });

  it("rejects the awaiter when Supabase is not configured", async () => {
    mockGetSupabaseBrowser.mockReturnValue(null);
    const { MfaChallengeDialog } = await import("./MfaChallengeDialog");
    render(<MfaChallengeDialog />);

    await expect(requestMfaChallenge()).rejects.toThrow(
      /MFA challenge failed/i,
    );
    // Dialog never opens — the bus rejects before the UI is shown.
    expect(screen.queryByText(/verify your second factor/i)).toBeNull();
  });

  it("rejects when no verified TOTP factor exists", async () => {
    mockListFactors.mockResolvedValue({
      data: { totp: [], all: [] },
      error: null,
    });
    const { MfaChallengeDialog } = await import("./MfaChallengeDialog");
    render(<MfaChallengeDialog />);

    await expect(requestMfaChallenge()).rejects.toThrow(
      /MFA challenge failed/i,
    );
    expect(screen.queryByText(/verify your second factor/i)).toBeNull();
  });

  it("rejects when listFactors itself throws", async () => {
    mockListFactors.mockRejectedValue(new Error("Network down"));
    const { MfaChallengeDialog } = await import("./MfaChallengeDialog");
    render(<MfaChallengeDialog />);

    await expect(requestMfaChallenge()).rejects.toThrow(
      /MFA challenge failed/i,
    );
  });
});

describe("MfaChallengeDialog - verify flow", () => {
  it("resolves the awaiter and closes the dialog on a valid code", async () => {
    mockChallengeAndVerify.mockResolvedValue({ data: null, error: null });
    const { MfaChallengeDialog } = await import("./MfaChallengeDialog");
    render(<MfaChallengeDialog />);

    const awaiter = requestMfaChallenge();

    const input = await screen.findByPlaceholderText("123456");
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /^verify$/i }));

    // The wrapper awaits this promise; resolving it is what lets a
    // queued clientFetch retry fire — so the resolve order matters.
    await expect(awaiter).resolves.toBeUndefined();
    expect(mockChallengeAndVerify).toHaveBeenCalledWith({
      factorId: VERIFIED_FACTOR_ID,
      code: "123456",
    });
    await waitFor(() => {
      expect(screen.queryByText(/verify your second factor/i)).toBeNull();
    });
  });

  it("blocks submit when the code is not 6 digits", async () => {
    const { MfaChallengeDialog } = await import("./MfaChallengeDialog");
    render(<MfaChallengeDialog />);

    // Swallow rejection from afterEach's forceCloseMfaChallenge —
    // the test isn't asserting on this promise; without the catch
    // Node logs an unhandled-rejection and fails the run.
    requestMfaChallenge().catch(() => {});

    const input = await screen.findByPlaceholderText("123456");
    fireEvent.change(input, { target: { value: "123" } });
    const verifyBtn = screen.getByRole("button", {
      name: /^verify$/i,
    }) as HTMLButtonElement;
    // disabled-on-short-input is the cheap UX guard before the
    // setError("Enter the 6-digit code") branch can fire. Read the
    // attribute directly because the project doesn't use jest-dom
    // matchers.
    expect(verifyBtn.disabled).toBe(true);
    expect(mockChallengeAndVerify).not.toHaveBeenCalled();
  });

  it("strips non-digits as the user types", async () => {
    const { MfaChallengeDialog } = await import("./MfaChallengeDialog");
    render(<MfaChallengeDialog />);

    // Swallow rejection from afterEach's forceCloseMfaChallenge —
    // the test isn't asserting on this promise; without the catch
    // Node logs an unhandled-rejection and fails the run.
    requestMfaChallenge().catch(() => {});

    const input = (await screen.findByPlaceholderText(
      "123456",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12-34 56" } });
    expect(input.value).toBe("123456");
  });

  it("surfaces the Supabase error message and leaves the dialog open", async () => {
    mockChallengeAndVerify.mockResolvedValue({
      data: null,
      error: new Error("Invalid code"),
    });
    const { MfaChallengeDialog } = await import("./MfaChallengeDialog");
    render(<MfaChallengeDialog />);

    // Fire-and-forget so the test isn't gated on the promise that
    // never resolves on a failed verify.
    // Swallow rejection from afterEach's forceCloseMfaChallenge —
    // the test isn't asserting on this promise; without the catch
    // Node logs an unhandled-rejection and fails the run.
    requestMfaChallenge().catch(() => {});

    const input = await screen.findByPlaceholderText("123456");
    fireEvent.change(input, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /^verify$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeNull();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/invalid code/i);
    // Dialog stays open so the user can retry without re-firing the
    // original request.
    expect(screen.queryByText(/verify your second factor/i)).not.toBeNull();
  });
});

describe("MfaChallengeDialog - cancel flow", () => {
  it("rejects the awaiter as cancelled and dismisses on Cancel click", async () => {
    const { MfaChallengeDialog } = await import("./MfaChallengeDialog");
    render(<MfaChallengeDialog />);

    const awaiter = requestMfaChallenge();
    await screen.findByPlaceholderText("123456");
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    await expect(awaiter).rejects.toThrow(/MFA challenge cancelled/i);
    await waitFor(() => {
      expect(screen.queryByText(/verify your second factor/i)).toBeNull();
    });
  });
});
