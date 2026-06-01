import { describe, expect, it } from "vitest";
import { humanizePasskeyError } from "./passkey-errors";

/** Asserts the mapping doesn't regress on the cases users will
 *  actually hit. The "anything else falls through" branch is
 *  deliberate — we never want to swallow diagnostic detail. */
describe("humanizePasskeyError", () => {
  it("maps NotAllowedError DOMException to a 'dismissed' message", () => {
    const err = new DOMException("not allowed", "NotAllowedError");
    expect(humanizePasskeyError(err)).toContain("dismissed");
  });

  it("maps 'timed out' string errors to the same dismissed message", () => {
    const err = new Error("The operation either timed out or was not allowed");
    expect(humanizePasskeyError(err)).toContain("dismissed");
  });

  it("maps webauthn_credential_not_found to a 'sign in with email' suggestion", () => {
    const err = new Error(
      "webauthn_credential_not_found: no matching credential",
    );
    expect(humanizePasskeyError(err)).toMatch(/email/i);
  });

  it("maps webauthn_credential_exists to an 'already registered' message", () => {
    const err = new Error("webauthn_credential_exists");
    expect(humanizePasskeyError(err)).toMatch(/already registered/i);
  });

  it("maps passkey_disabled to a 'not enabled' message", () => {
    const err = new Error("passkey_disabled: not enabled for this project");
    expect(humanizePasskeyError(err)).toMatch(/enabled/i);
  });

  it("maps challenge_expired to a 'took too long' message", () => {
    const err = new Error("webauthn_challenge_expired");
    expect(humanizePasskeyError(err)).toMatch(/too long/i);
  });

  it("maps too_many_passkeys to a 'remove one' message", () => {
    const err = new Error("too_many_passkeys");
    expect(humanizePasskeyError(err)).toMatch(/remove one/i);
  });

  it("falls through to the raw message when no case matches", () => {
    const err = new Error("Something genuinely unknown went wrong here");
    expect(humanizePasskeyError(err)).toBe(
      "Something genuinely unknown went wrong here",
    );
  });

  it("returns a generic fallback when the error has no message at all", () => {
    expect(humanizePasskeyError(null)).toMatch(/failed/i);
  });
});
