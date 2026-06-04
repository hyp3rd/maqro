"use client";

/** Browser-side helpers for archived report PDFs in the `exports` Supabase
 *  Storage bucket.
 *
 *  Objects live under `<user_id>/reports/<exportedAt>.json` — the same private
 *  bucket and RLS as the data backups (the policy keys on the *first* path
 *  segment, `<user_id>`, so the `reports/` subfolder is still owner-scoped),
 *  but a distinct prefix so the data-backup list (`listExports`, which scans
 *  `<user_id>/` and keeps only `.json` files) never surfaces a report and tries
 *  to import it.
 *
 *  Each object is a JSON {@link EncryptedEnvelope} whose ciphertext is the
 *  encrypted PDF bytes — the server only ever sees ciphertext. */
import type { EncryptedEnvelope } from "@/lib/export-crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "exports";
const PREFIX = "reports";
const STORAGE_TIMEOUT_MS = 120_000;

export type SavedReport = {
  /** `<user_id>/reports/<exportedAt>.json` — the full storage path. */
  path: string;
  /** ISO timestamp from the filename (what `exportedAt` was at upload time). */
  exportedAt: string;
  /** Bytes, from Supabase's storage metadata. */
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

/** Upload an encrypted report envelope to the user's `reports/` folder. The
 *  leading path segment must match `auth.uid()` or RLS rejects it. */
export async function uploadReport(
  supabase: SupabaseClient,
  userId: string,
  envelope: EncryptedEnvelope,
  exportedAt: string,
): Promise<string> {
  const path = `${userId}/${PREFIX}/${exportedAt}.json`;
  const blob = new Blob([JSON.stringify(envelope)], {
    type: "application/json",
  });
  await withTimeout("upload report", async () => {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, { contentType: "application/json", upsert: true });
    if (error) throw new Error(`upload report: ${error.message}`);
  });
  return path;
}

/** List the calling user's archived reports, most-recent first. */
export async function listReports(
  supabase: SupabaseClient,
  userId: string,
): Promise<SavedReport[]> {
  const { data, error } = await withTimeout("list reports", () =>
    supabase.storage
      .from(BUCKET)
      .list(`${userId}/${PREFIX}`, {
        sortBy: { column: "name", order: "desc" },
        limit: 100,
      }),
  );
  if (error) throw new Error(`list reports: ${error.message}`);
  if (!data) return [];
  return data
    .filter((entry) => entry.name.endsWith(".json"))
    .map((entry) => ({
      path: `${userId}/${PREFIX}/${entry.name}`,
      exportedAt: entry.name.replace(/\.json$/, ""),
      sizeBytes: (entry.metadata as { size?: number } | undefined)?.size ?? 0,
    }));
}

/** Download an archived report envelope as a Blob (the caller decrypts it). */
export async function downloadReport(
  supabase: SupabaseClient,
  path: string,
): Promise<Blob> {
  const { data, error } = await withTimeout("download report", () =>
    supabase.storage.from(BUCKET).download(path),
  );
  if (error) throw new Error(`download report: ${error.message}`);
  if (!data) throw new Error("download report: empty response");
  return data;
}

/** Delete an archived report. RLS ensures only the owner can delete it. */
export async function deleteReport(
  supabase: SupabaseClient,
  path: string,
): Promise<void> {
  const { error } = await withTimeout("delete report", () =>
    supabase.storage.from(BUCKET).remove([path]),
  );
  if (error) throw new Error(`delete report: ${error.message}`);
}
