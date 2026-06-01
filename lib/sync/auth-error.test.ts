import { describe, expect, it } from "vitest";
import { isAuthError } from "./auth-error";

describe("isAuthError", () => {
  it("returns true for HTTP 401 errors", () => {
    expect(isAuthError({ status: 401, message: "unauthorized" })).toBe(true);
  });

  it("returns true for PGRST301 (JWT expired)", () => {
    expect(isAuthError({ code: "PGRST301", message: "JWT expired" })).toBe(
      true,
    );
  });

  it("returns true for PGRST302 (anon not allowed)", () => {
    expect(
      isAuthError({
        code: "PGRST302",
        message: "Anonymous access not allowed",
      }),
    ).toBe(true);
  });

  it("matches the plaintext Supabase auth-error messages", () => {
    for (const msg of [
      "JWT expired",
      "Invalid JWT",
      "Auth session missing!",
      "Invalid Refresh Token: Already Used",
      "Refresh Token Not Found",
      "User not found",
    ]) {
      expect(isAuthError({ message: msg })).toBe(true);
    }
  });

  it("is case-insensitive on the message sniff", () => {
    expect(isAuthError({ message: "jwt EXPIRED" })).toBe(true);
  });

  it("returns false for non-auth errors", () => {
    expect(isAuthError({ status: 500, message: "server error" })).toBe(false);
    expect(isAuthError({ status: 502, message: "bad gateway" })).toBe(false);
    expect(isAuthError({ code: "23505", message: "duplicate key" })).toBe(
      false,
    );
    expect(isAuthError(new Error("network error"))).toBe(false);
  });

  it("handles primitives and nullish without throwing", () => {
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
    expect(isAuthError("string")).toBe(false);
    expect(isAuthError(401)).toBe(false);
  });
});
