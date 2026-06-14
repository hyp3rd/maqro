import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { consumeRecoveryGrant, createRecoveryGrant } from "./recovery-grant";

type GrantRow = {
  token_hash: string;
  user_id: string;
  expires_at: string;
  consumed_at: string | null;
};

const NOW = 1_700_000_000_000;
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

/** Fake service-role client covering the three chains recovery-grant uses:
 *  insert (create), select→eq→maybeSingle (read), update→eq→is→select (consume). */
function fakeAdmin(opts: {
  insertError?: unknown;
  row?: GrantRow | null;
  selectError?: unknown;
  updateResult?: { data: unknown[] | null; error: unknown };
}): {
  admin: SupabaseClient;
  inserted: { value?: Record<string, unknown> };
  updateCalls: { count: number };
} {
  const inserted: { value?: Record<string, unknown> } = {};
  const updateCalls = { count: 0 };

  function makeBuilder() {
    const b: Record<string, unknown> = {};
    let isUpdate = false;
    b.insert = (obj: Record<string, unknown>) => {
      inserted.value = obj;
      return Promise.resolve({ error: opts.insertError ?? null });
    };
    b.update = () => {
      isUpdate = true;
      updateCalls.count += 1;
      return b;
    };
    b.select = () =>
      isUpdate
        ? Promise.resolve(opts.updateResult ?? { data: [], error: null })
        : b;
    b.eq = () => b;
    b.is = () => b;
    b.maybeSingle = () =>
      Promise.resolve({
        data: opts.row ?? null,
        error: opts.selectError ?? null,
      });
    return b;
  }

  const admin = {
    from: vi.fn(() => makeBuilder()),
  } as unknown as SupabaseClient;
  return { admin, inserted, updateCalls };
}

describe("createRecoveryGrant", () => {
  it("stores ONLY the hash and returns the raw token", async () => {
    const { admin, inserted } = fakeAdmin({});
    const token = await createRecoveryGrant(admin, "user-1", NOW);
    expect(token).toBeTruthy();
    expect(inserted.value?.token_hash).toBe(sha(token!));
    // The raw token is never persisted.
    expect(inserted.value?.token_hash).not.toBe(token);
    expect(inserted.value?.user_id).toBe("user-1");
    expect(typeof inserted.value?.expires_at).toBe("string");
  });

  it("returns null on a write failure (fail-closed — no broken link)", async () => {
    const { admin } = fakeAdmin({ insertError: { message: "boom" } });
    expect(await createRecoveryGrant(admin, "user-1", NOW)).toBeNull();
  });
});

describe("consumeRecoveryGrant", () => {
  const validRow = (over: Partial<GrantRow> = {}): GrantRow => ({
    token_hash: sha("good-token"),
    user_id: "user-1",
    expires_at: new Date(NOW + 60_000).toISOString(),
    consumed_at: null,
    ...over,
  });

  it("redeems a valid grant and marks it consumed", async () => {
    const { admin, updateCalls } = fakeAdmin({
      row: validRow(),
      updateResult: { data: [{ token_hash: sha("good-token") }], error: null },
    });
    expect(await consumeRecoveryGrant(admin, "user-1", "good-token", NOW)).toBe(
      true,
    );
    expect(updateCalls.count).toBe(1); // single-use mark happened
  });

  it("rejects an empty token without touching the DB", async () => {
    const { admin } = fakeAdmin({});
    expect(await consumeRecoveryGrant(admin, "user-1", "", NOW)).toBe(false);
  });

  it("rejects when no grant matches the hash", async () => {
    const { admin } = fakeAdmin({ row: null });
    expect(await consumeRecoveryGrant(admin, "user-1", "good-token", NOW)).toBe(
      false,
    );
  });

  it("rejects a grant belonging to a different user", async () => {
    const { admin } = fakeAdmin({ row: validRow({ user_id: "someone-else" }) });
    expect(await consumeRecoveryGrant(admin, "user-1", "good-token", NOW)).toBe(
      false,
    );
  });

  it("rejects an expired grant", async () => {
    const { admin } = fakeAdmin({
      row: validRow({ expires_at: new Date(NOW - 1).toISOString() }),
    });
    expect(await consumeRecoveryGrant(admin, "user-1", "good-token", NOW)).toBe(
      false,
    );
  });

  it("rejects an already-consumed grant", async () => {
    const { admin } = fakeAdmin({
      row: validRow({ consumed_at: new Date(NOW - 1000).toISOString() }),
    });
    expect(await consumeRecoveryGrant(admin, "user-1", "good-token", NOW)).toBe(
      false,
    );
  });

  it("rejects when the atomic consume update matches no row (lost the race)", async () => {
    const { admin } = fakeAdmin({
      row: validRow(),
      updateResult: { data: [], error: null },
    });
    expect(await consumeRecoveryGrant(admin, "user-1", "good-token", NOW)).toBe(
      false,
    );
  });

  it("fails closed on a select error", async () => {
    const { admin } = fakeAdmin({ selectError: { message: "db down" } });
    expect(await consumeRecoveryGrant(admin, "user-1", "good-token", NOW)).toBe(
      false,
    );
  });
});
