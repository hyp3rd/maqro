import { describe, expect, it } from "vitest";
import { humanizeMfaError } from "./mfa-errors";

describe("humanizeMfaError", () => {
  it("maps the expired-token error to a refresh hint", () => {
    expect(
      humanizeMfaError(new Error("Token has expired or is invalid")),
    ).toMatch(/expired.*refresh|refresh.*current/i);
  });

  it("maps the invalid-code error to a 'didn't match' hint", () => {
    expect(humanizeMfaError(new Error("Invalid TOTP code entered"))).toMatch(
      /didn't match/i,
    );
  });

  it("maps rate-limit errors", () => {
    expect(humanizeMfaError(new Error("Too many requests"))).toMatch(
      /too many attempts/i,
    );
  });

  it("never leaks an unknown raw SDK string", () => {
    const out = humanizeMfaError(new Error("ECONNRESET tcp socket 0x9f"));
    expect(out).not.toMatch(/ECONNRESET|socket|0x9f/);
    expect(out).toMatch(/couldn't verify/i);
  });

  it("handles non-Error inputs without throwing", () => {
    expect(humanizeMfaError("Invalid code")).toMatch(/didn't match/i);
    expect(humanizeMfaError(null)).toMatch(/couldn't verify/i);
    expect(humanizeMfaError(undefined)).toMatch(/couldn't verify/i);
  });
});
