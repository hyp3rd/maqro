import { parseBody } from "@/lib/api/parse-body";
import { requireAdmin, writeAuditLog } from "@/lib/rbac";
import { _clearAllowlistCacheForTests } from "@/lib/recipe-import/host-allowlist";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

/** Loose on hostname — the project-specific `isLikelyBareHostname`
 *  check stays inline because it carries the actionable error
 *  message ("no scheme, path, or port"). Schema gates the field to
 *  a string + the note to a string bound. */
const BodySchema = z.object({
  hostname: z.string(),
  note: z.string().max(500).optional(),
});

/** Admin CRUD for the recipe-import hostname allowlist.
 *
 *   GET  /api/admin/recipe-import-allowlist
 *     → `{ entries: [{ hostname, note, created_at, created_by }] }`
 *
 *   POST /api/admin/recipe-import-allowlist  body: `{ hostname, note? }`
 *     → 201 with the inserted row, or 409 if the hostname exists.
 *
 *   DELETE /api/admin/recipe-import-allowlist?hostname=example.com
 *     → 204 on success.
 *
 *  Every mutating call drops the module-level cache in
 *  lib/recipe-import/host-allowlist so the next import request sees
 *  the change immediately - without this, an admin's "add hostname,
 *  test import" workflow would hit the 60 s TTL window. Reads don't
 *  need cache invalidation. */

export const runtime = "nodejs";

type EntryRow = {
  hostname: string;
  note: string | null;
  created_at: string;
  created_by: string | null;
};

function adminClient() {
  const secret = getSupabaseSecretConfig();
  if (!secret) return null;
  return createClient(secret.url, secret.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET(): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const admin = adminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Service-role key not configured." },
      { status: 503 },
    );
  }
  const { data, error } = await admin
    .from("recipe_import_host_allowlist")
    .select("hostname, note, created_at, created_by")
    .order("hostname", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ entries: (data ?? []) as EntryRow[] });
}

export async function POST(req: Request): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  // Normalize before validating so "Example.COM" → "example.com" lands
  // in the DB in the form the matcher expects. Reject scheme/path/port
  // - those would be silently CHECK-rejected by the table constraint
  // and return a confusing 500 otherwise.
  const hostname = parsed.data.hostname.trim().toLowerCase();
  if (!isLikelyBareHostname(hostname)) {
    return NextResponse.json(
      {
        error:
          "Hostname must be a bare lowercase domain (no scheme, path, or port).",
      },
      { status: 400 },
    );
  }
  const noteRaw = parsed.data.note?.trim() ?? "";
  const note = noteRaw.length > 0 ? noteRaw : null;

  const admin = adminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Service-role key not configured." },
      { status: 503 },
    );
  }
  const { data, error } = await admin
    .from("recipe_import_host_allowlist")
    .insert({ hostname, note, created_by: guard.userId })
    .select("hostname, note, created_at, created_by")
    .maybeSingle<EntryRow>();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "That hostname is already on the allowlist." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  _clearAllowlistCacheForTests();
  void writeAuditLog({
    adminUserId: guard.userId,
    action: "recipe_import_allowlist.add",
    payload: { hostname, note },
  });

  return NextResponse.json({ entry: data }, { status: 201 });
}

export async function DELETE(req: Request): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const hostname = new URL(req.url).searchParams
    .get("hostname")
    ?.trim()
    .toLowerCase();
  if (!hostname || !isLikelyBareHostname(hostname)) {
    return NextResponse.json(
      { error: "?hostname=… query is required." },
      { status: 400 },
    );
  }

  const admin = adminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Service-role key not configured." },
      { status: 503 },
    );
  }
  const { error } = await admin
    .from("recipe_import_host_allowlist")
    .delete()
    .eq("hostname", hostname);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  _clearAllowlistCacheForTests();
  void writeAuditLog({
    adminUserId: guard.userId,
    action: "recipe_import_allowlist.remove",
    payload: { hostname },
  });

  return new NextResponse(null, { status: 204 });
}

/** Bare-hostname check: lowercase, no scheme, no path, no port, at
 *  least one dot, only DNS-legal characters. Mirrors the SQL CHECK
 *  constraint so the route returns 400 with a clear message instead
 *  of letting Postgres reject with a generic 500. */
function isLikelyBareHostname(s: string): boolean {
  if (s.length === 0 || s.length > 253) return false;
  if (!/^[a-z0-9.-]+$/.test(s)) return false;
  if (!s.includes(".")) return false;
  if (s.startsWith(".") || s.endsWith(".")) return false;
  if (s.startsWith("-") || s.endsWith("-")) return false;
  if (s.includes("..")) return false;
  return true;
}
