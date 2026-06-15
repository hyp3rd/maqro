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
import { clientFetch } from "@/lib/auth/client-fetch";
import { useEffect, useState } from "react";
import { MonitorSmartphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useReportSecurityStatus } from "./security-status";

/** Settings → Trusted devices.
 *
 *  Lists every device on which the user checked "Trust this device
 *  for 7 days" during MFA verify, with the trust-grant timestamp,
 *  expiry, and IP/UA snapshot captured at trust time. Each row gets
 *  a Remove affordance, plus a top-level "Untrust all" for the case
 *  where the user wants to force MFA on every device.
 *
 *  Surface is intentionally lean - no rename, no per-row metadata
 *  drawer. The trust window is short (7 days; auto-expired by
 *  retention after 14), so this list churns quickly and a heavyweight
 *  UI would be premature. Rename only matters for long-lived rows.
 *
 *  Hidden for guests. Hidden when the list is empty AND the load has
 *  resolved - there's no value in advertising the feature here when
 *  the user hasn't used it yet (it's already exposed at the MFA
 *  verify step on /login). */

type TrustedDeviceRow = {
  id: string;
  device_id: string;
  device_label: string | null;
  user_agent: string | null;
  ip_address: string | null;
  trusted_at: string;
  trusted_until: string;
  last_used_at: string | null;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; rows: TrustedDeviceRow[] }
  | { kind: "error"; message: string };

export function TrustedDevicesSection({ signedIn }: { signedIn: boolean }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    fetch("/api/auth/mfa/trusted-devices")
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          // 401 here means the cookie session is gone - bubble up
          // as a soft error rather than crashing. 503 means Supabase
          // isn't configured (preview env).
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setState({
            kind: "error",
            message:
              body.error ??
              "Couldn't load your trusted devices. Please try again.",
          });
          return;
        }
        const body = (await res.json()) as { rows: TrustedDeviceRow[] };
        setState({ kind: "ok", rows: body.rows });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Couldn't load.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, reloadKey]);

  // Publish the trusted-device count up to the Security overview card (neutral
  // tone — trusted devices are a convenience, not a protection toggle).
  const reportSecurity = useReportSecurityStatus();
  const trustedCount = state.kind === "ok" ? state.rows.length : null;
  useEffect(() => {
    if (trustedCount === null) return;
    reportSecurity("trustedDevices", {
      value:
        trustedCount === 0
          ? "None"
          : trustedCount === 1
            ? "1 device"
            : `${trustedCount} devices`,
      tone: "muted",
    });
  }, [trustedCount, reportSecurity]);

  function refresh() {
    setReloadKey((k) => k + 1);
  }

  async function revoke(id: string) {
    setBusyId(id);
    try {
      const res = await clientFetch(`/api/auth/mfa/trusted-devices/${id}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Couldn't revoke trust.");
        return;
      }
      toast.success("Trust revoked.");
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function revokeAll() {
    setBulkBusy(true);
    try {
      const res = await clientFetch("/api/auth/mfa/trusted-devices", {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Couldn't revoke trusts.");
        return;
      }
      toast.success("All trusted devices revoked.");
      refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  if (!signedIn) return null;

  const header = (
    <header className="border-b border-border/60 px-5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <MonitorSmartphone className="h-4 w-4 text-muted-foreground" />
            Trusted devices
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Devices that skip the verification step until the trust expires.
            Revoke any to require two-step verification again on its next
            sign-in.
          </p>
        </div>
        {state.kind === "ok" && state.rows.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={bulkBusy}
                className="h-8 shrink-0 gap-1.5"
              >
                Untrust all
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Untrust every device?</AlertDialogTitle>
                <AlertDialogDescription>
                  Your next sign-in on any device will require the authenticator
                  code, including the device you&apos;re using right now.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={bulkBusy}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    void revokeAll();
                  }}
                  disabled={bulkBusy}
                >
                  {bulkBusy ? "Revoking…" : "Untrust all"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </header>
  );

  if (state.kind === "loading") {
    // Render nothing while loading rather than a placeholder card: this
    // section hides itself entirely when there are no trusted devices
    // (the common case), so a skeleton would only flash a card that then
    // collapses — the worse shift. The section appears (and the deep-link
    // scroll re-pins) only if devices come back.
    return null;
  }

  if (state.kind === "error") {
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {header}
        <p
          role="alert"
          className="px-5 py-4 text-xs text-red-600"
        >
          {state.message}
        </p>
      </section>
    );
  }

  if (state.rows.length === 0) {
    // Empty state (not hidden) so the login promise "you can revoke from
    // Settings" always lands on something, and the section reads consistently
    // with the other Security cards.
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {header}
        <p className="px-5 py-4 text-xs text-muted-foreground">
          No trusted devices yet. When you check “Trust this device for 7 days”
          while signing in, it shows up here — revoke it any time to require
          two-step verification on that device again.
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      {header}
      <ul className="animate-in fade-in divide-y divide-border/60 duration-300">
        {state.rows.map((row) => {
          const isBusy = busyId === row.id;
          const label = row.device_label ?? row.user_agent ?? "Unknown device";
          const trustedAt = new Date(row.trusted_at);
          const expiresAt = new Date(row.trusted_until);
          const lastUsedAt = row.last_used_at
            ? new Date(row.last_used_at)
            : null;
          return (
            <li
              key={row.id}
              className="flex items-start justify-between gap-3 px-5 py-3"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="truncate text-sm font-medium">{label}</p>
                <p className="text-[11px] text-muted-foreground">
                  Trusted {trustedAt.toLocaleDateString()} · expires{" "}
                  {expiresAt.toLocaleDateString()}
                  {lastUsedAt
                    ? ` · last used ${lastUsedAt.toLocaleDateString()}`
                    : ""}
                </p>
                {row.ip_address && (
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {row.ip_address}
                  </p>
                )}
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isBusy}
                    className="h-8 shrink-0 gap-1.5 border-red-500/40 text-red-700 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Revoke trust on this device?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Next sign-in on this device will require the authenticator
                      code again.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isBusy}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.preventDefault();
                        void revoke(row.id);
                      }}
                      disabled={isBusy}
                    >
                      {isBusy ? "Revoking…" : "Revoke"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
