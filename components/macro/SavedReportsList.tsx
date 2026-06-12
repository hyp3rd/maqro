"use client";

import { DestructiveConfirmDialog } from "@/components/ui/destructive-confirm-dialog";
import { useUser } from "@/hooks/use-user";
import { decryptBytes, isEncryptedEnvelope } from "@/lib/export-crypto";
import {
  deleteReport,
  downloadReport,
  listReports,
  type SavedReport,
} from "@/lib/storage/reports";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Trash2 } from "lucide-react";
import { PassphraseDialog } from "./PassphraseDialog";

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Lists the user's archived report PDFs (encrypted, in Supabase Storage under
 *  `<userId>/reports/`). Opening one downloads the envelope, prompts for the
 *  passphrase, decrypts it on-device, and saves the PDF — the server only ever
 *  held ciphertext. Signed-in only; renders nothing for guests.
 *
 *  `refreshKey` lets the parent force a re-fetch after a new archive. */
export function SavedReportsList({ refreshKey = 0 }: { refreshKey?: number }) {
  const { user } = useUser();
  const [reports, setReports] = useState<SavedReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SavedReport | null>(null);

  // Passphrase prompt (decrypt mode, with retry) — resolver pattern so the
  // open handler can await the entered passphrase.
  const [passOpen, setPassOpen] = useState(false);
  const [passBusy, setPassBusy] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);
  const resolver = useRef<((value: string | null) => void) | null>(null);

  useEffect(() => {
    // Signed-out renders nothing (early return below); signed-in always implies
    // Supabase is configured. So both guards just bail — no synchronous
    // setState (which the react-hooks rule disallows inside an effect); the
    // async `.then`/`.catch` below are fine.
    if (!user) return;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    let cancelled = false;
    listReports(supabase, user.id)
      .then((r) => {
        if (!cancelled) setReports(r);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Couldn't list reports.");
        setReports([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user, refreshKey]);

  function askPassphrase(err: string | null = null): Promise<string | null> {
    return new Promise((resolve) => {
      resolver.current = resolve;
      setPassError(err);
      setPassBusy(false);
      setPassOpen(true);
    });
  }
  function submitPassphrase(value: string) {
    setPassBusy(true);
    const r = resolver.current;
    resolver.current = null;
    r?.(value);
  }
  function cancelPassphrase() {
    setPassOpen(false);
    const r = resolver.current;
    resolver.current = null;
    r?.(null);
  }

  async function openReport(report: SavedReport) {
    setError(null);
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    setBusyPath(report.path);
    try {
      const blob = await downloadReport(supabase, report.path);
      const raw: unknown = JSON.parse(await blob.text());
      if (!isEncryptedEnvelope(raw)) {
        setError("This file isn't a recognized encrypted report.");
        return;
      }
      let pass = await askPassphrase();
      for (;;) {
        if (pass === null) {
          setPassOpen(false);
          return;
        }
        try {
          const bytes = await decryptBytes(raw, pass);
          setPassOpen(false);
          const pdf = new Blob([bytes], { type: "application/pdf" });
          const url = URL.createObjectURL(pdf);
          const a = document.createElement("a");
          a.href = url;
          a.download = `maqro-report-${report.exportedAt.slice(0, 10)}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 0);
          return;
        } catch (e) {
          pass = await askPassphrase(
            e instanceof Error ? e.message : "Wrong passphrase.",
          );
        }
      }
    } catch (e) {
      setPassOpen(false);
      setError(e instanceof Error ? e.message : "Couldn't open the report.");
    } finally {
      setBusyPath(null);
    }
  }

  async function removeReport(report: SavedReport) {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    setError(null);
    // Optimistic removal; restore on failure.
    const prev = reports;
    setReports((rs) => (rs ? rs.filter((r) => r.path !== report.path) : rs));
    try {
      await deleteReport(supabase, report.path);
    } catch (e) {
      setReports(prev ?? null);
      setError(e instanceof Error ? e.message : "Couldn't delete the report.");
    }
  }

  if (!user) return null;

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <h3 className="text-sm font-semibold tracking-tight">
          Archived reports
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Encrypted PDF snapshots saved from the report view. Opening one
          decrypts it on this device with your passphrase.
        </p>
      </header>
      <div className="px-5 py-4">
        {reports === null ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No archived reports yet. Open the report view and choose “Archive to
            cloud”.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {reports.map((r) => (
              <li
                key={r.path}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <FileText className="h-4 w-4 shrink-0 text-brand" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {fmtWhen(r.exportedAt)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.sizeBytes > 0
                        ? `${Math.max(1, Math.round(r.sizeBytes / 1024))} KB`
                        : "encrypted"}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => openReport(r)}
                    disabled={busyPath === r.path}
                    className="rounded-md border border-border/60 px-2 py-1 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    {busyPath === r.path ? "Opening…" : "Open"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(r)}
                    aria-label="Delete report"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p
            role="alert"
            className="mt-3 text-xs text-destructive"
          >
            {error}
          </p>
        )}
      </div>

      <DestructiveConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        title="Delete archived report?"
        description={
          pendingDelete
            ? `The encrypted backup from ${fmtWhen(pendingDelete.exportedAt)} will be permanently deleted. This can't be undone.`
            : ""
        }
        onConfirm={() => {
          if (pendingDelete) void removeReport(pendingDelete);
        }}
      />

      {passOpen && (
        <PassphraseDialog
          open
          mode="decrypt"
          busy={passBusy}
          error={passError}
          onSubmit={submitPassphrase}
          onCancel={cancelPassphrase}
        />
      )}
    </section>
  );
}

export default SavedReportsList;
