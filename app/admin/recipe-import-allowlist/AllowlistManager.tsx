"use client";

import { EmptyState } from "@/components/admin/EmptyState";
import { Button } from "@/components/ui/button";
import { DestructiveConfirmDialog } from "@/components/ui/destructive-confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clientFetch } from "@/lib/auth/client-fetch";
import { haptic } from "@/lib/haptics";
import { useState } from "react";
import { Link2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type Entry = { hostname: string; note: string | null; created_at: string };

/** Add/remove UI for the recipe-import allowlist.
 *
 *  Calls /api/admin/recipe-import-allowlist for both mutations and
 *  refreshes the server data via `router.refresh()` so the page
 *  re-runs the SELECT and the rendered list matches the DB. We
 *  optimistically update local state too so the UI feels snappy
 *  before the refresh round-trip completes. */
export function AllowlistManager({
  initialEntries,
}: {
  initialEntries: Entry[];
}) {
  const router = useRouter();
  const [entries, setEntries] = useState(initialEntries);
  const [hostname, setHostname] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // Hostname pending a removal confirm. Removing the last entry silently
  // flips recipe-import back to OPEN mode, so the delete goes behind the
  // shared confirm shell with a stronger warning on the final entry.
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  async function addEntry() {
    if (!hostname.trim()) return;
    setBusy(true);
    try {
      const res = await clientFetch("/api/admin/recipe-import-allowlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostname: hostname.trim().toLowerCase(),
          note: note.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        entry?: Entry;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't add entry.");
        return;
      }
      if (data.entry) {
        setEntries((cur) =>
          [...cur, data.entry as Entry].sort((a, b) =>
            a.hostname.localeCompare(b.hostname),
          ),
        );
      }
      setHostname("");
      setNote("");
      haptic("success");
      toast.success(`Added ${hostname.trim().toLowerCase()}.`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add entry.");
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(host: string) {
    setBusy(true);
    try {
      const res = await clientFetch(
        `/api/admin/recipe-import-allowlist?hostname=${encodeURIComponent(host)}`,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 204) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Couldn't remove entry.");
        return;
      }
      setEntries((cur) => cur.filter((e) => e.hostname !== host));
      toast.success(`Removed ${host}.`);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't remove entry.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void addEntry();
        }}
        className="space-y-3 rounded-lg border border-border/60 bg-card px-4 py-4"
      >
        <h2 className="text-sm font-medium">Add hostname</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr,2fr,auto] sm:items-end">
          <div className="space-y-1.5">
            <Label
              htmlFor="hostname"
              className="text-xs text-muted-foreground"
            >
              Hostname
            </Label>
            <Input
              id="hostname"
              type="text"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="cooking.nytimes.com"
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="note"
              className="text-xs text-muted-foreground"
            >
              Note (optional)
            </Label>
            <Input
              id="note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Approved by ops 2026-05-23"
              disabled={busy}
              maxLength={500}
            />
          </div>
          <Button
            type="submit"
            disabled={busy || hostname.trim().length === 0}
          >
            Add
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Bare hostname only (no scheme, path, or port). Subdomains of listed
          hosts are allowed automatically.
        </p>
      </form>

      {/* `overflow-x-auto` (not `overflow-hidden`) so a long hostname/note
          scrolls on a phone instead of being clipped off the right edge. */}
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Hostname</th>
              <th className="px-3 py-2 text-left font-medium">Note</th>
              <th className="px-3 py-2 text-left font-medium">Added</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <EmptyState
                    icon={Link2}
                    title="No hosts on the allowlist"
                    description="Recipe import is in open mode — any host is allowed. Add a host above to switch to allowlist-only."
                  />
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr
                  key={e.hostname}
                  className="border-t border-border/60"
                >
                  <td className="px-3 py-2 font-mono text-[13px]">
                    {e.hostname}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {e.note ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-[12px] text-muted-foreground">
                    {new Date(e.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingRemove(e.hostname)}
                      disabled={busy}
                      aria-label={`Remove ${e.hostname}`}
                      title="Remove"
                      className="coarse:h-11 coarse:w-11"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <DestructiveConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(o) => {
          if (!o) setPendingRemove(null);
        }}
        title={`Remove ${pendingRemove ?? "this host"}?`}
        description={
          entries.length === 1
            ? "This is the last allowed host. Removing it switches recipe import back to OPEN mode — any host becomes importable."
            : "Recipe imports from this host will be blocked. You can re-add it later."
        }
        actionLabel="Remove"
        onConfirm={() => {
          if (pendingRemove) {
            haptic("warning");
            void removeEntry(pendingRemove);
          }
          setPendingRemove(null);
        }}
      />
    </div>
  );
}
