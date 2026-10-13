import { describe, expect, it } from "vitest";
import { signOutRisk } from "./sign-out-guard";

describe("signOutRisk", () => {
  it("is safe only after a clean sync with nothing pending", () => {
    expect(
      signOutRisk({ status: { state: "synced", at: 1 }, pending: 0 }),
    ).toEqual({ atRisk: false, count: 0 });
  });

  it("flags writes made after the last successful sync", () => {
    expect(
      signOutRisk({ status: { state: "synced", at: 1 }, pending: 2 }),
    ).toEqual({ atRisk: true, count: 2 });
  });

  it("flags a failed sync even when the counter reads zero", () => {
    expect(
      signOutRisk({
        status: { state: "error", message: "Failed to fetch" },
        pending: 0,
      }),
    ).toEqual({ atRisk: true, count: 0 });
  });

  it("reports the larger of pending writes and conflicted rows", () => {
    expect(
      signOutRisk({ status: { state: "conflict", count: 3 }, pending: 1 }),
    ).toEqual({ atRisk: true, count: 3 });
  });

  it("cannot vouch for a page load that never synced or a sync in flight", () => {
    expect(signOutRisk({ status: { state: "idle" }, pending: 0 }).atRisk).toBe(
      true,
    );
    expect(
      signOutRisk({ status: { state: "syncing" }, pending: 0 }).atRisk,
    ).toBe(true);
  });
});
