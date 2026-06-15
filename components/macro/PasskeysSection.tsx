"use client";

import { Button } from "@/components/ui/button";
import { DestructiveConfirmDialog } from "@/components/ui/destructive-confirm-dialog";
import { Input } from "@/components/ui/input";
import { SkeletonSettingRows } from "@/components/ui/skeleton";
import { useWebAuthnSupported } from "@/hooks/use-webauthn-supported";
import { humanizePasskeyError } from "@/lib/auth/passkey-errors";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import * as React from "react";
import {
  Check,
  Fingerprint,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useReportSecurityStatus } from "./security-status";

/** Row shape returned by `supabase.auth.passkey.list()`. Kept local
 *  rather than imported from `@supabase/auth-js` so the component
 *  isn't coupled to the SDK's experimental type names — those tend
 *  to churn while the feature is behind a flag. */
type PasskeyRow = {
  id: string;
  friendly_name?: string;
  created_at: string;
  last_used_at?: string;
};

/** Result of the async `passkey.list()` round-trip. Kept separate
 *  from the final `LoadState` (computed below) so the effect doesn't
 *  need to `setState({ kind: "unsupported" })` synchronously — React
 *  19's `react-hooks/set-state-in-effect` rule rejects that pattern.
 *  We derive the "unsupported" / "loading" view from props instead. */
type FetchResult =
  | { kind: "pending" }
  | { kind: "loaded"; passkeys: PasskeyRow[] }
  // Supabase project hasn't flipped the passkey toggle in the dashboard.
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; message: string };

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; passkeys: PasskeyRow[] }
  | { kind: "unavailable"; reason: string }
  // The browser doesn't expose `window.PublicKeyCredential`.
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

/** Settings → Passkeys. Lets a signed-in user register / rename /
 *  delete WebAuthn credentials backed by Supabase's experimental
 *  passkey API.
 *
 *  Lives next to [MfaSection](./MfaSection.tsx) and
 *  [BackupEmailSection](./BackupEmailSection.tsx) in the security
 *  group of the Settings view; the three sections together describe
 *  the user's full second-factor + account-recovery posture.
 *
 *  Passkeys are AAL2 by default — a session opened with a passkey
 *  skips the TOTP challenge on subsequent fetches. We mention that
 *  in the section copy so users adding a passkey aren't surprised
 *  that the MFA prompt stops showing up.
 *
 *  Gated on `signedIn` AND on `(typeof PublicKeyCredential !==
 *  "undefined")`. The latter check survives WebAuthn-less browsers
 *  (older Edge, certain in-app WebViews) by rendering an explanatory
 *  state instead of the broken "Add a passkey" button. */
export function PasskeysSection({ signedIn }: { signedIn: boolean }) {
  const webauthnSupported = useWebAuthnSupported();
  const [fetchResult, setFetchResult] = React.useState<FetchResult>({
    kind: "pending",
  });
  const [busy, setBusy] = React.useState<
    "idle" | "registering" | "renaming" | "deleting"
  >("idle");
  // Inline rename — the row swaps the friendly_name display for an
  // input until the user saves or cancels. Kept at component scope
  // so the input stays mounted across re-renders triggered by the
  // refresh tick.
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameInput, setRenameInput] = React.useState("");
  const [tick, setTick] = React.useState(0);
  const [pendingRemove, setPendingRemove] = React.useState<{
    id: string;
    name: string;
  } | null>(null);

  const refresh = React.useCallback(() => setTick((t) => t + 1), []);

  React.useEffect(() => {
    // Skip the fetch entirely on the two non-fetching branches: not
    // signed in (nothing to list) and unsupported browser (the SDK
    // can't run the ceremony anyway). The rendered state for those
    // cases is derived from props below — no setState needed here.
    if (!signedIn) return;
    if (!webauthnSupported) return;
    let cancelled = false;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    void supabase.auth.passkey.list().then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        const msg = error.message.toLowerCase();
        if (
          msg.includes("passkey_disabled") ||
          msg.includes("not enabled") ||
          msg.includes("experimental")
        ) {
          setFetchResult({ kind: "unavailable", reason: error.message });
          return;
        }
        setFetchResult({ kind: "error", message: error.message });
        return;
      }
      setFetchResult({
        kind: "loaded",
        passkeys: (data ?? []) as PasskeyRow[],
      });
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, webauthnSupported, tick]);

  // Derived render state. Two cases come from props (cheap, no
  // round-trip); the rest map from the async fetch result.
  const state: LoadState = !webauthnSupported
    ? { kind: "unsupported" }
    : fetchResult.kind === "pending"
      ? { kind: "loading" }
      : fetchResult.kind === "loaded"
        ? { kind: "ready", passkeys: fetchResult.passkeys }
        : fetchResult.kind === "unavailable"
          ? { kind: "unavailable", reason: fetchResult.reason }
          : { kind: "error", message: fetchResult.message };

  // Publish passkey count up to the Security overview card (a number primitive
  // keeps the effect from re-firing on every render).
  const reportSecurity = useReportSecurityStatus();
  const passkeyCount = state.kind === "ready" ? state.passkeys.length : null;
  React.useEffect(() => {
    if (passkeyCount === null) return;
    reportSecurity(
      "passkeys",
      passkeyCount > 0
        ? {
            value: passkeyCount === 1 ? "1 added" : `${passkeyCount} added`,
            tone: "good",
          }
        : { value: "None", tone: "muted" },
    );
  }, [passkeyCount, reportSecurity]);

  async function registerPasskey() {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    setBusy("registering");
    try {
      const { error } = await supabase.auth.registerPasskey();
      if (error) throw error;
      toast.success("Passkey added. You can now sign in with it next time.");
      refresh();
    } catch (e) {
      toast.error(humanizePasskeyError(e));
    } finally {
      setBusy("idle");
    }
  }

  async function rename(passkeyId: string) {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    const friendlyName = renameInput.trim();
    if (!friendlyName) {
      toast.error("Name can't be empty.");
      return;
    }
    if (friendlyName.length > 120) {
      // Supabase caps friendly_name at 120 chars. Surface here so
      // the user sees an actionable message instead of the server's
      // raw validation error.
      toast.error("Name must be 120 characters or fewer.");
      return;
    }
    setBusy("renaming");
    try {
      const { error } = await supabase.auth.passkey.update({
        passkeyId,
        friendlyName,
      });
      if (error) throw error;
      toast.success("Passkey renamed.");
      setRenamingId(null);
      setRenameInput("");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't rename passkey.");
    } finally {
      setBusy("idle");
    }
  }

  async function remove(passkeyId: string) {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    setBusy("deleting");
    try {
      const { error } = await supabase.auth.passkey.delete({ passkeyId });
      if (error) throw error;
      toast.success("Passkey removed.");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove passkey.");
    } finally {
      setBusy("idle");
    }
  }

  function startRename(row: PasskeyRow) {
    setRenamingId(row.id);
    setRenameInput(row.friendly_name ?? "");
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameInput("");
  }

  if (!signedIn) return null;

  // The first-time explainer now lives once at the top of the Security group
  // (`SecurityIntro`); each branch below just returns its section directly.
  const header = (
    <header className="border-b border-border/60 px-5 py-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <Fingerprint className="h-4 w-4 text-muted-foreground" />
        Passkeys
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Sign in with Face ID, Touch ID, Windows Hello, or a hardware key — no
        code to type. Adding a passkey replaces the two-step verification prompt
        on devices that have it.
      </p>
    </header>
  );

  if (state.kind === "loading") {
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {header}
        <SkeletonSettingRows rows={2} />
      </section>
    );
  }

  if (state.kind === "unsupported") {
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {header}
        <p className="px-5 py-4 text-xs text-muted-foreground">
          This browser doesn&apos;t support WebAuthn. Open the app in a modern
          browser to add a passkey.
        </p>
      </section>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {header}
        <p className="px-5 py-4 text-xs text-muted-foreground">
          Passkeys aren&apos;t available on this instance. Contact the
          administrator to enable them.
        </p>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {header}
        <p
          role="alert"
          className="px-5 py-4 text-xs text-destructive"
        >
          {state.message}
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      {header}
      {state.passkeys.length === 0 ? (
        <div className="animate-in fade-in space-y-3 px-5 py-4 duration-300">
          <p className="text-xs text-muted-foreground">
            No passkeys yet. Add one from this device to skip the email-code
            sign-in on your next visit.
          </p>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            onClick={() => void registerPasskey()}
            disabled={busy !== "idle"}
          >
            {busy === "registering" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {busy === "registering" ? "Registering…" : "Add a passkey"}
          </Button>
        </div>
      ) : (
        <>
          <ul className="animate-in fade-in divide-y divide-border/60 duration-300">
            {state.passkeys.map((row) => {
              const isRenaming = renamingId === row.id;
              return (
                <li
                  key={row.id}
                  className="flex items-center gap-2 px-5 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    {isRenaming ? (
                      <Input
                        type="text"
                        value={renameInput}
                        onChange={(e) => setRenameInput(e.target.value)}
                        maxLength={120}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void rename(row.id);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelRename();
                          }
                        }}
                        className="h-8 max-w-xs text-sm"
                        aria-label={`Rename passkey ${row.friendly_name ?? row.id}`}
                      />
                    ) : (
                      <p className="truncate text-sm font-medium">
                        {row.friendly_name?.trim() || "Unnamed passkey"}
                      </p>
                    )}
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Added {formatDate(row.created_at)}
                      {row.last_used_at &&
                        ` · Last used ${formatDate(row.last_used_at)}`}
                    </p>
                  </div>
                  {isRenaming ? (
                    <>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground"
                        aria-label="Save name"
                        onClick={() => void rename(row.id)}
                        disabled={busy === "renaming"}
                      >
                        {busy === "renaming" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground"
                        aria-label="Cancel rename"
                        onClick={cancelRename}
                        disabled={busy === "renaming"}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground"
                        aria-label={`Rename passkey ${row.friendly_name ?? row.id}`}
                        onClick={() => startRename(row)}
                        disabled={busy !== "idle"}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        aria-label={`Remove passkey ${row.friendly_name ?? row.id}`}
                        onClick={() =>
                          setPendingRemove({
                            id: row.id,
                            name: row.friendly_name ?? row.id,
                          })
                        }
                        disabled={busy !== "idle"}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="border-t border-border/60 px-5 py-2.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => void registerPasskey()}
              disabled={busy !== "idle"}
            >
              {busy === "registering" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              {busy === "registering" ? "Registering…" : "Add another passkey"}
            </Button>
          </div>
        </>
      )}
      <DestructiveConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(o) => {
          if (!o) setPendingRemove(null);
        }}
        title="Remove this passkey?"
        description={
          pendingRemove
            ? `"${pendingRemove.name}" will no longer be able to sign you in. Make sure you have another way to log in first.`
            : ""
        }
        actionLabel="Remove"
        onConfirm={() => {
          if (pendingRemove) void remove(pendingRemove.id);
        }}
      />
    </section>
  );
}

/** Human-readable date for a row. Uses the user's locale; matches
 *  the formatting in [MfaSection](./MfaSection.tsx) and other
 *  settings rows so the security tiles read consistently. */
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
