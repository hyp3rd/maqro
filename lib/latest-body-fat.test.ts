import { describe, expect, it } from "vitest";
import { estimateBodyFat } from "@maqro/core/body-fat";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLatestBodyFatPct } from "./latest-body-fat";

type Row = {
  date: string;
  waist_cm: number | null;
  neck_cm: number | null;
  hips_cm: number | null;
};

/** A `from(...).select(...)` chain that records every call and answers
 *  with `rows` (or `error`) once awaited after `.limit`. */
function fakeAdmin(result: { data?: Row[]; error?: { message: string } }) {
  const calls: unknown[][] = [];
  const chain = {
    select: (...a: unknown[]) => (calls.push(["select", ...a]), chain),
    eq: (...a: unknown[]) => (calls.push(["eq", ...a]), chain),
    not: (...a: unknown[]) => (calls.push(["not", ...a]), chain),
    order: (...a: unknown[]) => (calls.push(["order", ...a]), chain),
    limit: async (...a: unknown[]) => {
      calls.push(["limit", ...a]);
      return { data: result.data ?? null, error: result.error ?? null };
    },
  };
  const admin = {
    from: (table: string) => (calls.push(["from", table]), chain),
  } as unknown as SupabaseClient;
  return { admin, calls };
}

describe("loadLatestBodyFatPct", () => {
  it("reads the newest owner row with waist + neck and estimates from it", async () => {
    const { admin, calls } = fakeAdmin({
      data: [{ date: "2026-10-20", waist_cm: 84, neck_cm: 38, hips_cm: null }],
    });
    const out = await loadLatestBodyFatPct(admin, "u1", {
      gender: "male",
      height: 178,
    });
    expect(out).toEqual({
      ok: true,
      bodyFatPct: estimateBodyFat({
        bodyType: "male",
        heightCm: 178,
        waistCm: 84,
        neckCm: 38,
      }),
    });
    expect(calls).toEqual([
      ["from", "body_measurements"],
      ["select", "date, waist_cm, neck_cm, hips_cm"],
      ["eq", "user_id", "u1"],
      ["not", "waist_cm", "is", null],
      ["not", "neck_cm", "is", null],
      ["order", "date", { ascending: false }],
      ["limit", 1],
    ]);
  });

  it("also requires hips for the female formula", async () => {
    const { admin, calls } = fakeAdmin({
      data: [{ date: "2026-10-20", waist_cm: 74, neck_cm: 33, hips_cm: 98 }],
    });
    const out = await loadLatestBodyFatPct(admin, "u2", {
      gender: "female",
      height: 165,
    });
    expect(out.ok && out.bodyFatPct).toBe(
      estimateBodyFat({
        bodyType: "female",
        heightCm: 165,
        waistCm: 74,
        neckCm: 33,
        hipCm: 98,
      }),
    );
    expect(calls).toContainEqual(["not", "hips_cm", "is", null]);
  });

  it("is null with no usable reading", async () => {
    const { admin } = fakeAdmin({ data: [] });
    expect(
      await loadLatestBodyFatPct(admin, "u1", { gender: "male", height: 178 }),
    ).toEqual({ ok: true, bodyFatPct: null });
  });

  it("makes no query for a gender with no published formula", async () => {
    const { admin, calls } = fakeAdmin({ data: [] });
    expect(
      await loadLatestBodyFatPct(admin, "u1", {
        gender: "nonbinary",
        height: 170,
      }),
    ).toEqual({ ok: true, bodyFatPct: null });
    expect(calls).toEqual([]);
  });

  it("returns a read error instead of treating it as no estimate", async () => {
    const { admin } = fakeAdmin({ error: { message: "db down" } });
    expect(
      await loadLatestBodyFatPct(admin, "u1", { gender: "male", height: 178 }),
    ).toEqual({ ok: false, error: { message: "db down" } });
  });
});
