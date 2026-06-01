"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clientFetch } from "@/lib/auth/client-fetch";
import { getCurrentSessionId, type DeviceRow } from "@/lib/devices/registry";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Check,
  Loader2,
  LogOut,
  MonitorSmartphone,
  Pencil,
  X,
} from "lucide-react";
import { toast } from "sonner";

const GRACE_HOURS = 12;
const GRACE_MS = GRACE_HOURS * 60 * 60 * 1000;

/** Settings → Signed-in devices. Lists every active Supabase session
 *  for the current user (one row per sign-in), labels the current
 *  device, lets the user rename any row, and lets them disconnect
 *  remote devices subject to the 12-hour grace constraint enforced
 *  by /api/devices/disconnect.
 *
 *  The grace constraint is also reflected in the UI: the Disconnect
 *  buttons are disabled with an inline note until the current device
 *  has been signed in for ≥ 12 hours. Renders nothing for guest
 *  users (no devices to manage). */
export function SignedInDevicesSection({ signedIn }: { signedIn: boolean }) {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Bulk-disconnect (every row except the current one) state. Kept
  // separate from the per-row `busyId` so a per-row disconnect mid-
  // flight doesn't visually conflict with the bulk progress.
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  // Re-fetch trigger: bumped by refresh() to re-run the load effect.
  // Cleaner than a free-floating useCallback that the lint flags as
  // "setState in effect" - the effect itself owns the setState
  // through the same async then-callback pattern the rest of the app
  // uses (ShoppingListView, ProgressView).
  const [reloadKey, setReloadKey] = useState(0);
  // `nowMs` ticks once a minute via useSyncExternalStore so the
  // grace timer + "last seen N minutes ago" labels stay current.
  // Using the external-store pattern (rather than setState in an
  // effect) keeps renders pure for react-hooks/purity while still
  // re-rendering when the clock advances. Returns null during SSR
  // so the snapshot is stable across hydration; the client then
  // hydrates with a real timestamp on first paint.
  const nowMs = useNowEveryMinute();

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    Promise.all([
      supabase
        .from("user_devices")
        .select("*")
        .order("last_seen_at", { ascending: false }),
      getCurrentSessionId(supabase),
    ])
      .then(([{ data: rows, error: listErr }, sid]) => {
        if (cancelled) return;
        if (listErr) {
          setError(listErr.message);
          return;
        }
        setError(null);
        setDevices((rows ?? []) as DeviceRow[]);
        setCurrentSessionId(sid);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Couldn't load devices.");
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, reloadKey]);

  function refresh() {
    setReloadKey((k) => k + 1);
  }

  if (!signedIn) return null;

  const currentDevice = devices?.find((d) => d.session_id === currentSessionId);
  const currentFirstSeenMs = currentDevice
    ? Date.parse(currentDevice.first_seen_at)
    : null;
  const ageMs =
    currentFirstSeenMs !== null && nowMs !== null
      ? nowMs - currentFirstSeenMs
      : 0;
  const inGrace = currentFirstSeenMs !== null && ageMs < GRACE_MS;
  const graceHoursLeft = inGrace
    ? Math.ceil((GRACE_MS - ageMs) / (60 * 60 * 1000))
    : 0;

  async function saveLabel(deviceId: string) {
    const trimmed = editValue.trim();
    if (!trimmed) {
      cancelEdit();
      return;
    }
    setBusyId(deviceId);
    try {
      const supabase = getSupabaseBrowser();
      if (!supabase) throw new Error("Supabase isn't configured.");
      const { error: updErr } = await supabase
        .from("user_devices")
        .update({ device_label: trimmed })
        .eq("id", deviceId);
      if (updErr) throw new Error(updErr.message);
      cancelEdit();
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't rename.");
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(d: DeviceRow) {
    setEditingId(d.id);
    setEditValue(d.device_label ?? "");
    setError(null);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
  }

  async function disconnect(deviceId: string) {
    setBusyId(deviceId);
    try {
      const res = await clientFetch("/api/devices/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        graceHoursRemaining?: number;
      };
      if (!res.ok) {
        toast.error(body.error ?? `Disconnect failed (${res.status}).`);
        return;
      }
      toast.success("Device disconnected. The other device will sign out.");
      refresh();
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  /** Disconnect every row except the current device.
   *
   *  Fan-out via the existing single-row endpoint. No bulk endpoint
   *  on the server because the per-row route already enforces RLS
   *  + the 12-hour grace and we'd just duplicate that logic. We
   *  collect per-call failures into a summary toast so the user
   *  sees what actually happened rather than just "done" when half
   *  of the calls failed.
   *
   *  The current row is identified by `session_id === currentSessionId`,
   *  the same predicate the per-row Disconnect button uses to hide
   *  itself. */
  async function disconnectAllOthers(targets: DeviceRow[]) {
    if (targets.length === 0) return;
    setBulkBusy(true);
    setBulkOpen(false);
    try {
      const results = await Promise.allSettled(
        targets.map((row) =>
          clientFetch("/api/devices/disconnect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deviceId: row.id }),
          }).then(async (res) => {
            if (!res.ok) {
              const body = (await res.json().catch(() => ({}))) as {
                error?: string;
              };
              throw new Error(body.error ?? `HTTP ${res.status}`);
            }
            return true;
          }),
        ),
      );
      const failures = results.filter((r) => r.status === "rejected").length;
      if (failures === 0) {
        toast.success(
          targets.length === 1
            ? "1 other session disconnected."
            : `${targets.length} other sessions disconnected.`,
        );
      } else if (failures < targets.length) {
        toast.warning(
          `${targets.length - failures} of ${targets.length} disconnected. ${failures} failed.`,
        );
      } else {
        toast.error(
          "None of the disconnects succeeded - check your connection or try one row at a time.",
        );
      }
      refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  // Rows other than the current device. Used to gate the bulk
  // disconnect affordance (hidden when there's nothing to clean up)
  // and as the target list when the user confirms. We allow the
  // button only when there's an identifiable current row - otherwise
  // "other" is meaningless and we'd risk signing the user out from
  // here too.
  const otherDevices = (devices ?? []).filter(
    (d) => currentSessionId !== null && d.session_id !== currentSessionId,
  );
  const canBulkDisconnect =
    !inGrace && currentDevice !== undefined && otherDevices.length > 0;

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="flex flex-col gap-2 border-b border-border/60 bg-muted/30 px-5 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <MonitorSmartphone className="h-4 w-4 text-muted-foreground" />
            Signed-in devices
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every browser you&apos;re signed in on. Rename to keep things
            straight; disconnect to sign a session out remotely.
          </p>
        </div>
        {canBulkDisconnect && (
          <AlertDialog
            open={bulkOpen}
            onOpenChange={(next) => {
              if (bulkBusy) return;
              setBulkOpen(next);
            }}
          >
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 self-start gap-1.5 sm:self-auto"
                disabled={bulkBusy}
              >
                {bulkBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LogOut className="h-3.5 w-3.5" />
                )}
                Disconnect others
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Disconnect all other sessions?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This signs out {otherDevices.length}{" "}
                  {otherDevices.length === 1 ? "session" : "sessions"} on other
                  browsers / devices. Your current device stays signed in. The
                  other sessions will sign out within a few seconds via the
                  realtime channel.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={bulkBusy}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    // Keep the dialog open while the fan-out runs so
                    // the user sees the busy state, then close from
                    // inside disconnectAllOthers on completion.
                    e.preventDefault();
                    void disconnectAllOthers(otherDevices);
                  }}
                  disabled={bulkBusy}
                >
                  {bulkBusy ? "Disconnecting…" : "Disconnect others"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </header>
      <div className="divide-y divide-border/60">
        {devices === null ? (
          <p className="px-5 py-6 text-center text-xs text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
            Loading devices…
          </p>
        ) : devices.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-muted-foreground">
            No devices yet - the next sync will register this one.
          </p>
        ) : (
          devices.map((d) => {
            const isCurrent = d.session_id === currentSessionId;
            const isEditing = editingId === d.id;
            const busy = busyId === d.id;
            return (
              <div
                key={d.id}
                className="flex items-start gap-3 px-5 py-3"
              >
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        autoFocus
                        maxLength={64}
                        disabled={busy}
                        className="h-8 text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveLabel(d.id);
                          else if (e.key === "Escape") cancelEdit();
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => void saveLabel(d.id)}
                        disabled={busy}
                        aria-label="Save"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={cancelEdit}
                        disabled={busy}
                        aria-label="Cancel"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">
                        {d.device_label ?? "Unnamed device"}
                      </p>
                      {isCurrent && (
                        <span className="rounded-full border border-foreground/30 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-foreground">
                          This device
                        </span>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={() => startEdit(d)}
                        disabled={busy}
                        aria-label="Rename device"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  <DeviceDetails
                    row={d}
                    nowMs={nowMs}
                  />
                </div>
                {!isCurrent && !isEditing && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 border-red-500/40 text-red-700 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-400"
                    onClick={() => void disconnect(d.id)}
                    disabled={busy || inGrace}
                    title={
                      inGrace
                        ? `Available in ~${graceHoursLeft} h (${GRACE_HOURS}h grace from this device's sign-in)`
                        : undefined
                    }
                  >
                    {busy ? "Disconnecting…" : "Disconnect"}
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
      {inGrace && devices && devices.length > 1 && (
        <p className="border-t border-amber-500/30 bg-amber-500/5 px-5 py-2 text-[11px] text-amber-800 dark:text-amber-300">
          Disconnecting other devices is available {graceHoursLeft}h from now -
          a {GRACE_HOURS}-hour grace from this device&apos;s first sign-in
          prevents a freshly-compromised session from locking out the real you.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="border-t border-red-500/30 bg-red-500/5 px-5 py-2 text-[11px] text-red-700 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </section>
  );
}

/** Returns the current wall-clock ms, re-rendering subscribers once
 *  a minute. Built on useSyncExternalStore so the read is pure and
 *  the subscribe-fn owns the timer - keeps us out of the
 *  setState-in-effect lint rule. Server snapshot is null to dodge
 *  hydration mismatches; the first client paint immediately swaps
 *  in a real timestamp.
 *
 *  Implementation notes - two contracts that BOTH have to be
 *  honored or `useSyncExternalStore` loops on render:
 *
 *    1. `getSnapshot` MUST return the same value between renders
 *       until the store actually changes. Returning `Date.now()`
 *       directly violates this - every read produces a fresh
 *       value, React sees "state changed", re-renders, reads
 *       again, sees another fresh value, loops forever. We cache
 *       the value at module scope and refresh it inside the
 *       interval tick instead.
 *
 *    2. `subscribe` MUST be a stable function reference across
 *       renders. An inline closure inside the hook body is a
 *       *new* function on every render, which React reads as
 *       "store changed" → re-subscribes → runs subscribe again
 *       → another loop (the immediate cause of the second
 *       "Maximum update depth" we hit). Both `subscribe` and the
 *       getSnapshot/getServerSnapshot triplet are hoisted to
 *       module scope below to keep the references identical
 *       across every render. */

let cachedNowMs: number | null = null;

function subscribeToNowEveryMinute(notify: () => void): () => void {
  // Seeding-on-mount belongs inside the subscribe closure (not at
  // module load) so SSR / server-side imports don't try to touch
  // `Date.now()` in a non-browser context. The first interval tick
  // fires after 60s; the seed below + the next notify make sure
  // the first client paint already has a real timestamp.
  cachedNowMs = Date.now();
  const id = window.setInterval(() => {
    cachedNowMs = Date.now();
    notify();
  }, 60 * 1000);
  // Notify once asynchronously so React re-reads getSnapshot and
  // picks up the seeded value. Calling notify() *synchronously*
  // inside subscribe is what triggered the re-entrance loop the
  // previous fix attempt hit - the microtask defers it past the
  // current render commit.
  queueMicrotask(notify);
  return () => window.clearInterval(id);
}

function getNowSnapshot(): number | null {
  return cachedNowMs;
}

function getNowServerSnapshot(): number | null {
  return null;
}

function useNowEveryMinute(): number | null {
  return useSyncExternalStore(
    subscribeToNowEveryMinute,
    getNowSnapshot,
    getNowServerSnapshot,
  );
}

/** Per-row metadata block: first-seen + last-seen with absolute
 *  date AND relative time, location (city, country), and IP. The
 *  redundancy is on purpose - "5 hours ago" is the at-a-glance read,
 *  while the absolute date disambiguates two same-day sessions of
 *  the same browser on the same machine.
 *
 *  Lines that have nothing to show are dropped entirely. On a non-
 *  Vercel deployment (localhost, self-host) the geo headers are
 *  always null and the location line just doesn't render - better
 *  than a "-, -" placeholder that reads as a missing-data bug. */
function DeviceDetails({
  row,
  nowMs,
}: {
  row: DeviceRow;
  nowMs: number | null;
}) {
  const location = formatLocation(row);
  return (
    <div className="mt-1 space-y-0.5 text-[11px] tabular-nums text-muted-foreground">
      <p>
        First seen {formatAbsolute(row.first_seen_at)} (
        {relativeTime(row.first_seen_at, nowMs)})
      </p>
      <p>
        Last seen {formatAbsolute(row.last_seen_at)} (
        {relativeTime(row.last_seen_at, nowMs)})
      </p>
      {location && <p>From {location}</p>}
      {row.ip_address && <p className="font-mono">IP {row.ip_address}</p>}
    </div>
  );
}

/** Format the geo columns into "City, Country" / "Country" / null.
 *  We prefer the city when available because country alone is too
 *  coarse for the "is that my Berlin laptop or my Munich one?"
 *  question this section is meant to answer. */
function formatLocation(row: DeviceRow): string | null {
  const city = row.geo_city?.trim();
  const country = row.geo_country?.trim();
  if (city && country) return `${city}, ${country}`;
  if (city) return city;
  if (country) return country;
  return null;
}

/** Locale-formatted absolute date+time (e.g. "May 21, 2026, 09:14").
 *  Uses the browser's locale because the device-management UI is
 *  inherently personal - a user reading "where am I signed in?"
 *  wants the timestamp in the format their OS gave them. */
function formatAbsolute(iso: string): string {
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

/** "3 hours ago" / "5 days ago" / "just now". `nowMs` is threaded in
 *  from a `setInterval`-driven state variable in the caller so the
 *  function stays pure - calling Date.now() during render trips
 *  react-hooks/purity. Returns "-" while nowMs hasn't been
 *  initialized yet (pre-hydration / first paint). */
function relativeTime(iso: string, nowMs: number | null): string {
  if (nowMs === null) return "-";
  const ms = nowMs - Date.parse(iso);
  if (ms < 60 * 1000) return "just now";
  if (ms < 60 * 60 * 1000) {
    const mins = Math.round(ms / (60 * 1000));
    return `${mins} min${mins === 1 ? "" : "s"} ago`;
  }
  if (ms < 24 * 60 * 60 * 1000) {
    const hrs = Math.round(ms / (60 * 60 * 1000));
    return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  }
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
