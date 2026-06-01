import { describe, expect, it } from "vitest";
import { asError } from "./index";

describe("asError", () => {
  it("wraps a PostgrestError-shaped object in a real Error so React's overlay shows useful text", () => {
    const err = asError(
      { message: "new row violates row-level security policy", code: "42501" },
      "push custom foods",
    );
    expect(err).toBeInstanceOf(Error);
    // The whole point — a real Error has a useful .toString(), not "[object Object]".
    expect(err.message).toContain("push custom foods");
    expect(err.message).toContain("new row violates row-level security policy");
    expect(err.message).toContain("(42501)");
  });

  it("appends the details string when present", () => {
    const err = asError(
      {
        message: "permission denied",
        code: "42501",
        details: "table custom_foods, column diet_kind",
      },
      "push custom foods",
    );
    expect(err.message).toContain("permission denied");
    expect(err.message).toContain("(42501)");
    expect(err.message).toContain("— table custom_foods, column diet_kind");
  });

  it("works without code or details (sparse error)", () => {
    const err = asError({ message: "something went wrong" }, "pull profile");
    expect(err.message).toBe("pull profile: something went wrong");
  });

  it("falls back to a generic message when the err object has no message", () => {
    // Defensive — Supabase always populates message in practice, but if
    // someone passes a stray empty object we shouldn't end up with
    // "context: undefined".
    const err = asError({}, "push profile");
    expect(err.message).toContain("push profile");
    expect(err.message).toContain("Supabase error");
  });
});
