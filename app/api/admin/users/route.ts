import { requireAdmin } from "@/lib/rbac";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Admin-only user listing with pagination, search, and status
 *  filtering.
 *
 *  Query params:
 *    - `q`      — case-insensitive email substring (in-memory
 *                 filter; auth.users.email isn't indexed for
 *                 trigram but the user count is small enough).
 *    - `filter` — one of: `all` (default) | `premium` | `free` |
 *                 `banned` | `traced`. Filter is applied AFTER the
 *                 email substring filter, so search + filter
 *                 compose. `banned` reads auth.users.banned_until;
 *                 `traced` reads profiles.traced (migration 0033).
 *    - `page`   — 1-indexed.
 *    - `per`    — page size, capped at 100.
 *
 *  Returns email + role + tier signals + ban + traced flags.
 *  Emails are intentionally NOT redacted at this surface — admins
 *  need them to do their job. Future privacy enhancement: per-row
 *  "Reveal email" with audit-logged unmasking. */

const DEFAULT_PER = 25;
const MAX_PER = 100;

const ALLOWED_FILTERS = new Set(["all", "premium", "free", "banned", "traced"]);

export async function GET(req: Request): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.toLowerCase() ?? "";
  const filterRaw = url.searchParams.get("filter") ?? "all";
  const filter = ALLOWED_FILTERS.has(filterRaw) ? filterRaw : "all";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const per = Math.min(
    MAX_PER,
    Math.max(1, Number(url.searchParams.get("per") ?? String(DEFAULT_PER))),
  );

  const config = getSupabaseSecretConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Supabase service-role key not configured." },
      { status: 503 },
    );
  }
  const admin = createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Pull a wide page from auth.admin.listUsers, then in-memory
  // filter + paginate. Works fine up to a few thousand users; if
  // we grow past that we'll need a proper SQL view that joins
  // auth.users with profiles.
  const { data: usersData, error: usersErr } = await admin.auth.admin.listUsers(
    { page: 1, perPage: 1000 },
  );
  if (usersErr) {
    return NextResponse.json({ error: usersErr.message }, { status: 500 });
  }
  const allUsers = usersData?.users ?? [];

  // Pre-fetch profile rows for EVERY user we might keep, so the
  // status filter (premium / traced) can run against profile
  // data. The filter narrows the slice; we still only pay the
  // batched-profile cost once per request.
  const allIds = allUsers.map((u) => u.id);
  const profileMap = new Map<
    string,
    {
      role: string | null;
      is_premium: boolean | null;
      subscription_status: string | null;
      stripe_price_id: string | null;
      traced: boolean;
    }
  >();
  if (allIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select(
        "user_id, role, is_premium, subscription_status, stripe_price_id, traced",
      )
      .in("user_id", allIds);
    for (const p of profiles ?? []) {
      profileMap.set(p.user_id as string, {
        role: (p.role as string | undefined) ?? null,
        is_premium: (p.is_premium as boolean | undefined) ?? null,
        subscription_status:
          (p.subscription_status as string | undefined) ?? null,
        stripe_price_id: (p.stripe_price_id as string | undefined) ?? null,
        traced: (p.traced as boolean | undefined) ?? false,
      });
    }
  }

  // Filter cascade: email substring → status filter. Order
  // matters; status filter is cheaper-per-row than email lower-
  // casing so it goes second only because the first narrowing is
  // by far the more common user action.
  const emailFiltered = q
    ? allUsers.filter((u) => u.email?.toLowerCase().includes(q))
    : allUsers;
  const statusFiltered = emailFiltered.filter((u) => {
    const p = profileMap.get(u.id);
    switch (filter) {
      case "premium":
        return p?.is_premium === true;
      case "free":
        return p?.is_premium !== true;
      case "banned": {
        // Supabase exposes `banned_until` on the user record when
        // a ban is active. Past-dated values (timeboxed bans that
        // have expired) don't count — we treat the user as
        // un-banned the moment the timestamp passes.
        const until = (u as { banned_until?: string | null }).banned_until;
        if (!until) return false;
        if (until === "infinity") return true;
        return new Date(until).getTime() > Date.now();
      }
      case "traced":
        return p?.traced === true;
      default:
        return true;
    }
  });

  const total = statusFiltered.length;
  const start = (page - 1) * per;
  const slice = statusFiltered.slice(start, start + per);

  // Compute `is_banned` server-side rather than letting the UI
  // call `Date.now()` per row in render (React's purity rule
  // disallows impure calls inside components). One timestamp
  // for the whole page is also more consistent than per-row
  // clock reads on the client.
  const nowMs = Date.now();
  const rows = slice.map((u) => {
    const p = profileMap.get(u.id);
    const bannedUntil =
      (u as { banned_until?: string | null }).banned_until ?? null;
    const isBanned =
      bannedUntil !== null &&
      (bannedUntil === "infinity" || new Date(bannedUntil).getTime() > nowMs);
    return {
      id: u.id,
      email: u.email ?? null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      role: p?.role ?? "user",
      is_premium: p?.is_premium ?? false,
      subscription_status: p?.subscription_status ?? null,
      stripe_price_id: p?.stripe_price_id ?? null,
      banned_until: bannedUntil,
      is_banned: isBanned,
      traced: p?.traced ?? false,
    };
  });

  return NextResponse.json({ rows, total, page, per, filter });
}
