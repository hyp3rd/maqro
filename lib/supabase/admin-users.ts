import type { AuthError, User } from "@supabase/supabase-js";

/** Users requested per `auth.admin.listUsers` call. GoTrue's offset-paginated
 *  `/admin/users` endpoint defaults to 50 when `per_page` is omitted and does
 *  not cap it, so a large page keeps the round-trip count low. */
export const AUTH_USERS_PAGE_SIZE = 1000;

/** The slice of `supabase.auth.admin` this module needs (`GoTrueAdminApi`
 *  satisfies it structurally), so callers pass `admin.auth.admin` and tests
 *  pass a typed fake. */
export interface AuthUserLister {
  listUsers(params: {
    page: number;
    perPage: number;
  }): Promise<
    | { data: { users: User[]; total?: number }; error: null }
    | { data: { users: [] }; error: AuthError }
  >;
}

export type ListAllAuthUsersResult =
  { users: User[]; error: null } | { users: null; error: AuthError };

/** Every auth user, walking `auth.admin.listUsers` page by page.
 *
 *  A bare `listUsers()` returns only GoTrue's default page of 50, so callers
 *  that need the whole user base (cron email maps, the admin user list) must
 *  page explicitly.
 *
 *  Termination does NOT use the SDK's `nextPage`: auth-js (2.117.x) derives it
 *  from the first character of the page number in the `Link` header, so it is
 *  wrong from page 10 on. Instead we stop on a short page (the last page of an
 *  offset listing) or once we have collected the `X-Total-Count` total — the
 *  latter also ends the walk when the final page is exactly full.
 *
 *  An error on any page fails the whole call: a partial list would silently
 *  drop users, which is the bug this helper exists to prevent. */
export async function listAllAuthUsers(
  admin: AuthUserLister,
  perPage: number = AUTH_USERS_PAGE_SIZE,
): Promise<ListAllAuthUsersResult> {
  if (!Number.isInteger(perPage) || perPage < 1) {
    throw new RangeError(`perPage must be a positive integer, got ${perPage}`);
  }
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.listUsers({ page, perPage });
    if (error) return { users: null, error };
    users.push(...data.users);
    const total = data.total ?? 0;
    if (data.users.length < perPage || (total > 0 && users.length >= total)) {
      return { users, error: null };
    }
  }
}

/** `user id → email` for users that have one (phone-only / anonymous users
 *  have no email and are left out). */
export function emailsById(users: readonly User[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const u of users) {
    if (u.email) map.set(u.id, u.email);
  }
  return map;
}
