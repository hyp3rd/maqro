import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AuthError, type User } from "@supabase/supabase-js";
import {
  AUTH_USERS_PAGE_SIZE,
  type AuthUserLister,
  emailsById,
  listAllAuthUsers,
} from "./admin-users";

function fakeUser(n: number): User {
  return {
    id: `user-${n}`,
    email: `u${n}@x.test`,
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
  };
}

/** Serves `count` users through GoTrue's offset pagination, honouring the
 *  requested page / perPage like the real `/admin/users` endpoint. `nextPage`
 *  is deliberately garbage (auth-js derives it from the first character of the
 *  Link header's page number, so it is wrong from page 10 on) — the helper
 *  must not depend on it. */
function fakeLister(count: number) {
  const all = Array.from({ length: count }, (_, i) => fakeUser(i + 1));
  const listUsers = vi.fn<AuthUserLister["listUsers"]>(
    async ({ page, perPage }) => ({
      data: {
        users: all.slice((page - 1) * perPage, page * perPage),
        nextPage: 1,
        lastPage: 1,
        total: count,
      },
      error: null,
    }),
  );
  return { listUsers };
}

describe("listAllAuthUsers", () => {
  it("returns every user across pages, not just the server's default page", async () => {
    const lister = fakeLister(AUTH_USERS_PAGE_SIZE * 2 + 7);
    const result = await listAllAuthUsers(lister);
    expect(result.error).toBeNull();
    expect(result.users).toHaveLength(AUTH_USERS_PAGE_SIZE * 2 + 7);
    expect(new Set(result.users?.map((u) => u.id)).size).toBe(
      AUTH_USERS_PAGE_SIZE * 2 + 7,
    );
    expect(lister.listUsers).toHaveBeenCalledTimes(3);
    expect(lister.listUsers.mock.calls.map((c) => c[0])).toEqual([
      { page: 1, perPage: AUTH_USERS_PAGE_SIZE },
      { page: 2, perPage: AUTH_USERS_PAGE_SIZE },
      { page: 3, perPage: AUTH_USERS_PAGE_SIZE },
    ]);
  });

  it("stops after one request when the first page is short", async () => {
    const lister = fakeLister(3);
    const result = await listAllAuthUsers(lister);
    expect(result.users).toHaveLength(3);
    expect(lister.listUsers).toHaveBeenCalledTimes(1);
  });

  it("stops at the reported total when the last page is exactly full", async () => {
    const lister = fakeLister(AUTH_USERS_PAGE_SIZE);
    const result = await listAllAuthUsers(lister);
    expect(result.users).toHaveLength(AUTH_USERS_PAGE_SIZE);
    expect(lister.listUsers).toHaveBeenCalledTimes(1);
  });

  it("walks past page 9 even though auth-js mis-parses nextPage there", async () => {
    const lister = fakeLister(12 * 10 + 1);
    const result = await listAllAuthUsers(lister, 10);
    expect(result.users).toHaveLength(121);
    expect(lister.listUsers).toHaveBeenCalledTimes(13);
  });

  it("handles an empty user base", async () => {
    const lister = fakeLister(0);
    const result = await listAllAuthUsers(lister);
    expect(result).toEqual({ users: [], error: null });
    expect(lister.listUsers).toHaveBeenCalledTimes(1);
  });

  it("surfaces an error from any page instead of returning a partial list", async () => {
    const lister = fakeLister(AUTH_USERS_PAGE_SIZE + 5);
    const err = new AuthError("boom", 500);
    const firstPage = await fakeLister(AUTH_USERS_PAGE_SIZE + 5).listUsers({
      page: 1,
      perPage: AUTH_USERS_PAGE_SIZE,
    });
    lister.listUsers.mockResolvedValueOnce(firstPage);
    lister.listUsers.mockResolvedValueOnce({ data: { users: [] }, error: err });
    const result = await listAllAuthUsers(lister);
    expect(result).toEqual({ users: null, error: err });
  });

  it("rejects a non-positive page size", async () => {
    await expect(listAllAuthUsers(fakeLister(1), 0)).rejects.toThrow(
      RangeError,
    );
  });
});

describe("emailsById", () => {
  it("maps ids to emails and skips users without one", () => {
    const map = emailsById([
      fakeUser(1),
      { ...fakeUser(2), email: undefined },
      fakeUser(3),
    ]);
    expect([...map.entries()]).toEqual([
      ["user-1", "u1@x.test"],
      ["user-3", "u3@x.test"],
    ]);
  });
});

describe("listUsers call sites", () => {
  // A direct `auth.admin.listUsers(...)` returns a single page (50 users by
  // default), which is how the cron email maps silently dropped everyone past
  // the first page. All listing must go through `listAllAuthUsers`.
  it("only lib/supabase/admin-users.ts calls listUsers directly", () => {
    const root = path.resolve(__dirname, "../..");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (
          /\.tsx?$/.test(entry.name) &&
          !/\.test\.tsx?$/.test(entry.name) &&
          /\.listUsers\(/.test(readFileSync(full, "utf8"))
        ) {
          offenders.push(path.relative(root, full));
        }
      }
    };
    walk(path.join(root, "app"));
    walk(path.join(root, "lib"));
    expect(offenders).toEqual(["lib/supabase/admin-users.ts"]);
  });
});
