"use client";

/** Browser-side helpers for the `exports` Supabase Storage bucket.
 *
 *  Object naming is `<user_id>/<exportedAt>.json`. The RLS policy in
 *  `supabase/migrations/0004_exports_storage.sql` uses the first path
 *  segment as the owner key, so all CRUD operations naturally scope to
 *  the calling user without an extra `eq("user_id", …)` filter.
 *
 *  All functions accept a `SupabaseClient` so the caller controls
 *  whether they're authenticated (the bucket is private — un-authed
 *  reads / writes return 403). */
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "exports";
/** Per-call timeout for storage requests. Generous because uploads
 *  scale with bundle size and downloads pull the full payload. */
const STORAGE_TIMEOUT_MS = 120_000;

/** Metadata for a single cloud export listing. The Supabase storage
 *  listing returns more fields; we surface only what the UI uses. */
export type CloudExport = {
  /** `<user_id>/<exportedAt>.json` — the full storage path. */
  path: string;
  /** ISO timestamp from the filename — what `bundle.exportedAt` was at
   *  upload time. We display this rather than the bucket's `created_at`
   *  because clock skew between client and server can confuse users. */
  exportedAt: string;
  /** Bytes. From Supabase's storage metadata. */
  sizeBytes: number;
};

async function withTimeout<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STORAGE_TIMEOUT_MS);
  try {
    return await fn();
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || controller.signal.aborted)
    ) {
      throw new Error(`${label} timed out after ${STORAGE_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Upload an export bundle (JSON-serializable object) as a blob to the
 *  user's folder. Returns the path on success. The path's leading
 *  segment must match `auth.uid()` or the RLS policy rejects it. */
export async function uploadExport(
  supabase: SupabaseClient,
  userId: string,
  bundle: { exportedAt: string },
): Promise<string> {
  const path = `${userId}/${bundle.exportedAt}.json`;
  const body = JSON.stringify(bundle, null, 2);
  const blob = new Blob([body], { type: "application/json" });
  await withTimeout("upload export", async () => {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, { contentType: "application/json", upsert: true });
    if (error) throw new Error(`upload export: ${error.message}`);
  });
  return path;
}

/** List the calling user's cloud exports, most-recent first. The
 *  bucket's `list()` already filters by prefix via the userId folder.
 *  Returns `[]` for users with no uploads — the storage API treats a
 *  missing folder as an empty list, not an error. */
export async function listExports(
  supabase: SupabaseClient,
  userId: string,
): Promise<CloudExport[]> {
  const { data, error } = await withTimeout("list exports", () =>
    supabase.storage
      .from(BUCKET)
      .list(userId, { sortBy: { column: "name", order: "desc" }, limit: 100 }),
  );
  if (error) throw new Error(`list exports: ${error.message}`);
  if (!data) return [];
  return data
    .filter((entry) => entry.name.endsWith(".json"))
    .map((entry) => ({
      path: `${userId}/${entry.name}`,
      exportedAt: entry.name.replace(/\.json$/, ""),
      sizeBytes: (entry.metadata as { size?: number } | undefined)?.size ?? 0,
    }));
}

/** Download a cloud export as a Blob. Caller decides what to do with
 *  it — usually parse + plan-import or pipe to `URL.createObjectURL`
 *  for a "Save to disk" follow-up. */
export async function downloadExport(
  supabase: SupabaseClient,
  path: string,
): Promise<Blob> {
  const { data, error } = await withTimeout("download export", () =>
    supabase.storage.from(BUCKET).download(path),
  );
  if (error) throw new Error(`download export: ${error.message}`);
  if (!data) throw new Error("download export: empty response");
  return data;
}

/** Delete a cloud export. RLS ensures only the owner can delete their
 *  own paths — passing someone else's path returns a 403 we surface
 *  unchanged. */
export async function deleteExport(
  supabase: SupabaseClient,
  path: string,
): Promise<void> {
  const { error } = await withTimeout("delete export", () =>
    supabase.storage.from(BUCKET).remove([path]),
  );
  if (error) throw new Error(`delete export: ${error.message}`);
}
