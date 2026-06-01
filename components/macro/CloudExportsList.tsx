"use client";

import { Button } from "@/components/ui/button";
import {
  deleteExport,
  downloadExport,
  listExports,
  type CloudExport,
} from "@/lib/storage/exports";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { Cloud, CloudDownload, FileJson, Loader2, Trash2 } from "lucide-react";

type Props = {
  /** Bumped by the parent after a successful save-to-cloud so the list
   *  re-fetches without needing its own pub-sub. */
  refreshKey: number;
  /** Fires when the user clicks "Download & review" — caller fetches
   *  the JSON and opens the import preview. */
  onPickForImport: (entry: CloudExport) => void;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatExportedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function CloudExportsList({ refreshKey, onPickForImport }: Props) {
  const [entries, setEntries] = useState<CloudExport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);

  // Load on mount + whenever refreshKey bumps. Every state write happens
  // inside the async IIFE — never synchronously in the effect body — so
  // the lint rule's "no sync setState in effect" stays satisfied.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseBrowser();
      if (!supabase) {
        if (!cancelled) {
          setError("Supabase isn't configured.");
          setEntries([]);
        }
        return;
      }
      try {
        const { data, error: userErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (userErr) throw userErr;
        if (!data.user) {
          setEntries([]);
          return;
        }
        const list = await listExports(supabase, data.user.id);
        if (!cancelled) {
          setEntries(list);
          setError(null);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load.");
        setEntries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // Used by the delete optimistic-recovery path to re-fetch from scratch.
  async function reload(): Promise<void> {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const list = await listExports(supabase, data.user.id);
      setEntries(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
  }

  async function saveToDisk(entry: CloudExport) {
    setDownloadingPath(entry.path);
    setError(null);
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setError("Supabase isn't configured.");
      setDownloadingPath(null);
      return;
    }
    try {
      const blob = await downloadExport(supabase, entry.path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `macro-calculator-export-${entry.exportedAt.slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setDownloadingPath(null);
    }
  }

  async function remove(entry: CloudExport) {
    if (
      !confirm(
        `Delete the cloud copy from ${formatExportedAt(entry.exportedAt)}? Local data is unaffected.`,
      )
    )
      return;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    // Optimistic remove.
    setEntries((prev) =>
      prev ? prev.filter((e) => e.path !== entry.path) : prev,
    );
    try {
      await deleteExport(supabase, entry.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
      await reload();
    }
  }

  if (entries === null) {
    return <p className="px-1 py-2 text-xs text-muted-foreground">Loading…</p>;
  }
  if (error) {
    return (
      <p
        role="alert"
        className="px-1 py-2 text-xs text-destructive"
      >
        {error}
      </p>
    );
  }
  if (entries.length === 0) {
    return (
      <p className="px-1 py-3 text-xs text-muted-foreground">
        No cloud exports yet. Use{" "}
        <span className="font-medium text-foreground">Save to cloud</span> on an
        export to back it up here.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {entries.map((entry) => (
        <li
          key={entry.path}
          className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2"
        >
          <FileJson className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">
              {formatExportedAt(entry.exportedAt)}
            </div>
            <div className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {formatBytes(entry.sizeBytes)}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onPickForImport(entry)}
            title="Download & review for import"
          >
            <Cloud className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => saveToDisk(entry)}
            disabled={downloadingPath === entry.path}
            title="Save to disk"
          >
            {downloadingPath === entry.path ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CloudDownload className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => remove(entry)}
            title="Delete cloud copy"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
