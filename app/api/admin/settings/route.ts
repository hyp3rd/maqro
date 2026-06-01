import { isLikelyEmail } from "@/lib/account/backup-email";
import { parseBody } from "@/lib/api/parse-body";
import {
  getSetting,
  setSetting,
  SETTING_DEFAULTS,
  SETTING_KEYS,
} from "@/lib/app-settings";
import { requireAdmin, writeAuditLog } from "@/lib/rbac";
import { NextResponse } from "next/server";
import { z } from "zod";

/** Schema gates shape (string + string). The whitelist + per-key
 *  value validators stay inline because they reference runtime
 *  constants and call helpers like `isLikelyEmail` whose error
 *  messages are more actionable than Zod's regex output. */
const BodySchema = z.object({ key: z.string(), value: z.string() });

/** Admin CRUD for the app_settings key/value store. Today the only
 *  surfaced setting is `support_inbox` (the address /api/support
 *  forwards to); the route is shaped to accept any whitelisted key
 *  so future runtime config (webhook URLs, maintenance banner,
 *  …) drops in here without a route refactor.
 *
 *   GET  → `{ settings: { key: value, … } }` - all whitelisted keys
 *         with their current value or the compiled-in default.
 *   POST body `{ key, value }` → 204 on success; 400 on unknown key
 *         or bad value; 500 on a Supabase write failure. */

export const runtime = "nodejs";

// Widened to Set<string> so the runtime check below can take any
// string (vs. a literal-narrowed key the type system already
// "knows" about).
const WHITELIST: ReadonlySet<string> = new Set(Object.values(SETTING_KEYS));

/** Per-key validators. A setting that doesn't have one here gets
 *  the default "non-empty trimmed string" check.
 *
 *  Email validation uses the canonical `isLikelyEmail` helper.
 *  The earlier inline regex (`^[^\s@]+@[^\s@]+\.[^\s@]+$`) was
 *  flagged by CodeQL as polynomial-backtracking - same class of
 *  ReDoS we closed in lib/auth/signup-guard. */
const VALIDATORS: Record<string, (v: string) => string | null> = {
  [SETTING_KEYS.supportInbox]: (v) =>
    isLikelyEmail(v) ? null : "Must be a valid email address.",
};

export async function GET(): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const entries = await Promise.all(
    Object.values(SETTING_KEYS).map(async (key) => {
      const value = await getSetting(key, SETTING_DEFAULTS[key]);
      return [key, value] as const;
    }),
  );
  return NextResponse.json({ settings: Object.fromEntries(entries) });
}

export async function POST(req: Request): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { key, value } = parsed.data;
  if (!WHITELIST.has(key)) {
    return NextResponse.json(
      { error: "Unknown setting key." },
      { status: 400 },
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return NextResponse.json(
      { error: "value can't be empty." },
      { status: 400 },
    );
  }
  const validator = VALIDATORS[key];
  if (validator) {
    const err = validator(trimmed);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  const result = await setSetting({
    key: key,
    value: trimmed,
    updatedBy: guard.userId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  void writeAuditLog({
    adminUserId: guard.userId,
    action: "settings.update",
    payload: { key: key, value: trimmed },
  });
  return new NextResponse(null, { status: 204 });
}
