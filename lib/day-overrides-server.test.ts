import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDayOverrides } from "./day-overrides-server";

type Row = { date: string; day: unknown };

/** A `from(...).select(...)` chain that records every call and answers
 *  with `data` (or `error`) once awaited after the last filter. */
function fakeAdmin(result: { data?: Row[]; error?: { message: string } }) {
  const calls: unknown[][] = [];
  const settled = {
    then: (resolve: (v: { data: Row[] | null; error: unknown }) => unknown) =>
      resolve({ data: result.data ?? null, error: result.error ?? null }),
  };
  const chain = {
    select: (...a: unknown[]) => (calls.push(["select", ...a]), chain),
    eq: (...a: unknown[]) => (calls.push(["eq", ...a]), chain),
    gte: (...a: unknown[]) => (calls.push(["gte", ...a]), chain),
    lte: (...a: unknown[]) => (calls.push(["lte", ...a]), settled),
  };
  const admin = {
    from: (table: string) => (calls.push(["from", table]), chain),
  } as unknown as SupabaseClient;
  return { admin, calls };
}

describe("loadDayOverrides", () => {
  it("reads the owner's rows in the window and returns them raw", async () => {
    const rows = [
      { date: "2026-10-20", day: { type: "rest" } },
      { date: "2026-10-22", day: "garbage" },
    ];
    const { admin, calls } = fakeAdmin({ data: rows });

    const out = await loadDayOverrides(admin, "u1", {
      from: "2026-10-19",
      to: "2026-10-25",
    });

    // Raw: `targetsForDate` validates each day and ignores a malformed one.
    expect(out).toEqual({ ok: true, rows });
    expect(calls).toEqual([
      ["from", "training_day_overrides"],
      ["select", "date, day"],
      ["eq", "user_id", "u1"],
      ["gte", "date", "2026-10-19"],
      ["lte", "date", "2026-10-25"],
    ]);
  });

  it("no rows is an empty list", async () => {
    const { admin } = fakeAdmin({});
    expect(
      await loadDayOverrides(admin, "u1", {
        from: "2026-10-19",
        to: "2026-10-25",
      }),
    ).toEqual({ ok: true, rows: [] });
  });

  it("returns a read error instead of pretending there are no overrides", async () => {
    const { admin } = fakeAdmin({ error: { message: "db down" } });
    expect(
      await loadDayOverrides(admin, "u1", {
        from: "2026-10-19",
        to: "2026-10-25",
      }),
    ).toEqual({ ok: false, error: { message: "db down" } });
  });
});
