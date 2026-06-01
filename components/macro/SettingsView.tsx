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
import { Label } from "@/components/ui/label";
import { useAiUsage } from "@/hooks/use-ai-usage";
import { useNotificationPrefs } from "@/hooks/use-notification-prefs";
import { useUser } from "@/hooks/use-user";
import { isLikelyEmail } from "@/lib/account/backup-email";
import { clientFetch } from "@/lib/auth/client-fetch";
import { signOutAndClearLocal } from "@/lib/auth/sign-out";
import { clearAllStores } from "@/lib/db";
import {
  buildExport,
  downloadExport,
  exportPhaseIndex,
  type ExportProgress,
} from "@/lib/export";
import { planFromFile, planImport, type ImportPlan } from "@/lib/import";
import { GITHUB_REPO_URL } from "@/lib/links";
import {
  downloadExport as downloadCloudExport,
  uploadExport,
} from "@/lib/storage/exports";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { UnitSystem } from "@/lib/units";
import { APP_VERSION } from "@/lib/version";
import { useEffect, useRef, useState } from "react";
import {
  Cloud,
  CloudUpload,
  Download,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
  UserCircle2,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { BackupEmailSection } from "./BackupEmailSection";
import { BillingDetails } from "./BillingDetails";
import { CloudExportsList } from "./CloudExportsList";
import { ConnectedAccountsSection } from "./ConnectedAccountsSection";
import { ImportPreviewDialog } from "./ImportPreviewDialog";
import { MfaSection } from "./MfaSection";
import { PasskeysSection } from "./PasskeysSection";
import { SignedInDevicesSection } from "./SignedInDevicesSection";
import { TrustedDevicesSection } from "./TrustedDevicesSection";
import { UpgradeDialog } from "./UpgradeDialog";

function formatDate(iso: string | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Props injected by the parent (`macro-calculator.tsx`). Settings
 *  doesn't run its own profile state — that would create a second
 *  `useProfile` instance and double-up the debounced writes. The
 *  parent owns the profile; SettingsView only takes the slice it
 *  needs (units) and a setter that goes through `patchProfile`. */
export function SettingsView({
  units,
  onUnitsChange,
}: {
  units: UnitSystem;
  onUnitsChange: (next: UnitSystem) => void;
}) {
  const { user, isLoaded, isUnconfigured } = useUser();

  // Export state: progress-aware, supports save-to-disk and save-to-cloud.
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(
    null,
  );
  const [cloudRefreshKey, setCloudRefreshKey] = useState(0);

  // Import state: preview-then-apply flow. The dialog renders the diff
  // and runs `importBundle` only after the user clicks Apply.
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null);
  const [importRaw, setImportRaw] = useState<unknown>(null);
  const [importSource, setImportSource] = useState("");
  const importInputRef = useRef<HTMLInputElement | null>(null);

  async function signOut() {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    // Best-effort: drop this device from the user_devices list before
    // tearing down the session, so it doesn't linger as a ghost row.
    // Failure is non-blocking - the auth signOut still has to run.
    if (user) {
      const { unregisterCurrentDevice } =
        await import("@/lib/devices/registry");
      await unregisterCurrentDevice(supabase, user.id).catch(() => {});
    }
    await signOutAndClearLocal(supabase);
  }

  /** Build a fresh export bundle, emitting progress events as each store
   *  is read. Returns the bundle so the two save paths (disk, cloud) can
   *  share the build phase. */
  async function buildWithProgress() {
    setExportError(null);
    setExportBusy(true);
    setExportProgress(null);
    try {
      const bundle = await buildExport(
        user ? { id: user.id, email: user.email ?? null } : null,
        (e) => setExportProgress(e),
      );
      return bundle;
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed.");
      throw e;
    }
  }

  async function handleExportToDisk() {
    try {
      const bundle = await buildWithProgress();
      downloadExport(bundle);
    } catch {
      // buildWithProgress already set the error.
    } finally {
      setExportBusy(false);
      setExportProgress(null);
    }
  }

  async function handleExportToCloud() {
    if (!user) {
      setExportError("Sign in to save to cloud.");
      return;
    }
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setExportError("Supabase isn't configured.");
      return;
    }
    try {
      const bundle = await buildWithProgress();
      await uploadExport(supabase, user.id, bundle);
      // Bumps the CloudExportsList refreshKey so it pulls the new entry.
      setCloudRefreshKey((k) => k + 1);
    } catch (e) {
      // buildWithProgress sets exportError on its failures; the upload
      // call can also fail with its own message.
      if (e instanceof Error) setExportError(e.message);
    } finally {
      setExportBusy(false);
      setExportProgress(null);
    }
  }

  /** File-picker → parse → plan → open preview dialog. The dialog runs
   *  the actual `importBundle` after the user confirms. */
  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Clear the input so picking the same file twice in a row re-fires onChange.
    e.target.value = "";
    if (!file) return;
    setImportError(null);
    setImportBusy(true);
    try {
      const { raw, plan } = await planFromFile(file);
      setImportRaw(raw);
      setImportPlan(plan);
      setImportSource(`file ${file.name}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImportBusy(false);
    }
  }

  /** Cloud-export-list click → fetch the blob → parse → plan → preview. */
  async function handleCloudPick(entry: { path: string; exportedAt: string }) {
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setImportError("Supabase isn't configured.");
      return;
    }
    setImportError(null);
    setImportBusy(true);
    try {
      const blob = await downloadCloudExport(supabase, entry.path);
      const text = await blob.text();
      const raw: unknown = JSON.parse(text);
      const plan = await planImport(raw);
      setImportRaw(raw);
      setImportPlan(plan);
      setImportSource(
        `cloud export ${new Date(entry.exportedAt).toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })}`,
      );
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImportBusy(false);
    }
  }

  const exportStep = exportProgress
    ? exportPhaseIndex(exportProgress.phase)
    : null;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <header className="border-b border-border/60 px-5 py-3">
          <h3 className="text-sm font-semibold tracking-tight">Account</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Identity, sync, and sign-out.
          </p>
        </header>
        <div className="px-5 py-4">
          {!isLoaded ? (
            <div className="space-y-2">
              <div className="h-3 w-32 animate-pulse rounded bg-muted" />
              <div className="h-2 w-48 animate-pulse rounded bg-muted/50" />
            </div>
          ) : isUnconfigured ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p className="text-foreground">
                Supabase isn&apos;t configured for this build.
              </p>
              <p className="text-xs leading-relaxed">
                Sign-in and multi-device sync are disabled. The app is running
                in <span className="font-medium">guest mode</span> - everything
                is stored in IndexedDB on this device. See README → Supabase
                setup to enable accounts.
              </p>
            </div>
          ) : user ? (
            <div className="space-y-4">
              <Row
                icon={<UserCircle2 className="h-4 w-4" />}
                label="Signed in as"
                value={user.email ?? "Anonymous"}
              />
              <Row
                icon={<ShieldCheck className="h-4 w-4" />}
                label="Member since"
                value={formatDate(user.created_at)}
              />
              <div className="flex items-center justify-between border-t border-border/60 pt-4">
                <div className="text-xs text-muted-foreground">
                  Sign out clears the session on this device. Your data stays in
                  IndexedDB and re-syncs when you sign back in.
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={signOut}
                  className="h-8 gap-1.5"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="space-y-1 text-sm">
                <p className="font-medium text-foreground">Not signed in</p>
                <p className="text-xs text-muted-foreground">
                  Sign in to back up your data and sync across devices.
                </p>
              </div>
              <Link
                href="/login"
                className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border/60 bg-card px-3 text-sm font-medium hover:bg-accent"
              >
                <LogIn className="h-3.5 w-3.5" />
                Sign in
              </Link>
            </div>
          )}
        </div>
      </section>

      {user && <ChangeEmailSection currentEmail={user.email ?? null} />}

      {user && <BackupEmailSection signedIn={Boolean(user)} />}

      {user && <MfaSection signedIn={Boolean(user)} />}

      {user && <PasskeysSection signedIn={Boolean(user)} />}

      {user && <TrustedDevicesSection signedIn={Boolean(user)} />}

      {user && <ConnectedAccountsSection signedIn={Boolean(user)} />}

      {user && <AiUsageSection />}

      {user && <NotificationsSection />}

      <UnitsSection
        units={units}
        onChange={onUnitsChange}
      />

      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <header className="border-b border-border/60 px-5 py-3">
          <h3 className="text-sm font-semibold tracking-tight">Your data</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Export a backup or merge an existing one back in. Save-to-cloud and
            cloud listings are signed-in only.
          </p>
        </header>
        <div className="space-y-4 px-5 py-4">
          {/* ─── Export controls ──────────────────────────────────────── */}
          {/* Mobile stacks text + buttons; sm+ restores the side-by-side
              row. Buttons grow to full width when stacked so the tap
              target is obvious, snap back to compact on sm+. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0 flex-1 space-y-1 text-xs text-muted-foreground">
              <p>
                Profile, daily logs, weight history, custom foods, meal
                templates, and recipes - packaged as a single JSON bundle.
              </p>
              {exportError && (
                <p
                  role="alert"
                  className="text-red-600"
                >
                  {exportError}
                </p>
              )}
              {exportProgress && exportStep && (
                <p className="flex items-center gap-1.5 font-mono text-[11px] text-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Exporting{" "}
                  {exportProgress.phase === "done"
                    ? "…"
                    : `${exportProgress.phase} (${exportStep.step + 1}/${exportStep.total})`}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleExportToDisk}
                disabled={exportBusy}
                className="h-9 gap-1.5 sm:h-8"
              >
                <Download className="h-3.5 w-3.5" />
                {exportBusy && !user ? "Preparing…" : "Save to disk"}
              </Button>
              {user && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleExportToCloud}
                  disabled={exportBusy}
                  className="h-9 gap-1.5 sm:h-8"
                  title="Upload to your private cloud bucket"
                >
                  <CloudUpload className="h-3.5 w-3.5" />
                  Save to cloud
                </Button>
              )}
            </div>
          </div>

          {/* ─── Cloud exports list (signed-in only) ───────────────── */}
          {user && (
            <div className="space-y-2 border-t border-border/60 pt-4">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Cloud className="h-3 w-3" />
                <span>Cloud backups</span>
              </div>
              <CloudExportsList
                refreshKey={cloudRefreshKey}
                onPickForImport={(entry) => handleCloudPick(entry)}
              />
            </div>
          )}

          {/* ─── Import (always available) ─────────────────────────── */}
          <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0 flex-1 space-y-1 text-xs text-muted-foreground">
              <p>
                Restore from a previous export. We show a diff first; nothing is
                applied until you confirm. Re-importing the same bundle is safe
                - rows merge by id.
              </p>
              {importError && (
                <p
                  role="alert"
                  className="text-red-600"
                >
                  {importError}
                </p>
              )}
            </div>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImportFile}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => importInputRef.current?.click()}
              disabled={importBusy}
              className="h-9 shrink-0 gap-1.5 sm:h-8"
            >
              <Upload className="h-3.5 w-3.5" />
              {importBusy ? "Reading…" : "Import from file"}
            </Button>
          </div>
        </div>
      </section>

      <ImportPreviewDialog
        open={importPlan !== null}
        onOpenChange={(open) => {
          if (!open) {
            setImportPlan(null);
            setImportRaw(null);
          }
        }}
        plan={importPlan}
        raw={importRaw}
        source={importSource}
        onApplied={() => {
          // Force a reload so every hook re-hydrates from IDB.
          window.setTimeout(() => window.location.reload(), 600);
        }}
      />

      {user && <BillingSection />}

      <AboutSection />

      <SignedInDevicesSection signedIn={user !== null} />

      <ResetDeviceSection signedIn={user !== null} />

      {user && (
        <DeleteAccountSection
          userEmail={user.email ?? null}
          configured={!isUnconfigured}
        />
      )}
    </div>
  );
}

/** Clears every IndexedDB store on this device and (when signed in)
 *  signs out - so the next session starts from a clean slate while
 *  the user's actual Supabase-side data is preserved. Different from
 *  DeleteAccount in that the server-side rows aren't touched.
 *
 *  Practical motivation: the demo-seed → sign-in path could leak
 *  sample rows into IDB before the SyncManager fix landed; existing
 *  installs that hit that bug need a one-tap recovery without
 *  destroying their account. Also useful for "this device is acting
 *  weird, reset and re-sync" troubleshooting and for handing the
 *  device to someone else. */
function ResetDeviceSection({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    setBusy(true);
    try {
      await clearAllStores();
      // Best-effort: clear local flags that survive an IDB wipe.
      // localStorage isn't part of clearAllStores because it's not
      // an IDB store; an explicit drop keeps onboarding / demo flags
      // from giving the next user (or the next sign-in on this
      // device) a stale state.
      try {
        window.localStorage.removeItem("maqro:onboarding-done");
        window.localStorage.removeItem("maqro:demo-loaded");
        window.localStorage.removeItem("maqro:sidebar-collapsed");
      } catch {
        // Storage disabled - fine, the rest of the reset is still
        // useful.
      }

      if (signedIn) {
        const supabase = getSupabaseBrowser();
        if (supabase) await signOutAndClearLocal(supabase);
      }
      // Hard navigation so the next request starts with empty cookies
      // and a freshly-mounted client. /login is the right destination
      // signed-in OR out - guests land on the form and can either log
      // in or hit "← back to landing".
      window.location.assign("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed.");
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-amber-500/30 bg-card">
      <header className="border-b border-amber-500/30 bg-amber-500/5 px-5 py-3">
        <h3 className="text-sm font-semibold tracking-tight text-amber-800 dark:text-amber-300">
          Reset this device
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Wipes local data only. Your Supabase account stays intact.
        </p>
      </header>
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <p className="text-xs text-muted-foreground">
          Use this to clear cached data after a sample-data session, to
          troubleshoot a stuck app, or to hand the device to someone else.
          {signedIn && " You'll be signed out."}
        </p>
        <AlertDialog
          open={open}
          onOpenChange={(next) => {
            if (busy) return;
            setOpen(next);
            if (!next) setError(null);
          }}
        >
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1.5 border-amber-500/40 text-amber-800 hover:bg-amber-500/10 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-300"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset device
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset this device?</AlertDialogTitle>
              <AlertDialogDescription>
                Local data on this device will be wiped (IndexedDB +
                preferences). Your Supabase account and synced data stay where
                they are - signing back in restores everything.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error && (
              <p
                role="alert"
                className="pt-2 text-xs text-red-600"
              >
                {error}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  confirm();
                }}
                disabled={busy}
                className="bg-amber-600 text-white hover:bg-amber-700"
              >
                {busy ? "Resetting…" : "Reset device"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
}

/** Plan + renewal date + Upgrade / Manage CTAs. Reads the same
 *  `/api/billing/usage` payload the AI-usage indicator above
 *  uses (extended in migration 0016 to include subscription
 *  state), so there's no extra round-trip.
 *
 *  Visible only when signed in - anonymous users have no billing
 *  surface. Hidden entirely when Stripe isn't configured on the
 *  deployment (the checkout / portal routes 503 in that case;
 *  there's nothing to upgrade *into*). */
function BillingSection() {
  const { state, refresh } = useAiUsage();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);

  // Don't render anything until we have data. Loading state for a
  // tiny "Plan: …" line is more flicker than information.
  if (state.status !== "ok") return null;
  const { isPremium, subscriptionStatus, currentPeriodEnd } = state.data;

  async function openPortal() {
    setPortalBusy(true);
    try {
      const res = await clientFetch("/api/billing/portal", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        // 503 = Stripe not configured. Other errors propagate
        // to the user via alert; no toast available here without
        // additional imports.
        alert(data.error ?? "Couldn't open the billing portal.");
        return;
      }
      window.location.assign(data.url);
    } finally {
      setPortalBusy(false);
    }
  }

  const renewalLabel = (() => {
    if (!currentPeriodEnd) return null;
    const formatted = formatDate(currentPeriodEnd);
    if (
      subscriptionStatus === "canceled" ||
      subscriptionStatus === "incomplete_expired"
    ) {
      return `Access ends ${formatted}`;
    }
    return `Renews ${formatted}`;
  })();

  const isPastDue = subscriptionStatus === "past_due";

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <h3 className="text-sm font-semibold tracking-tight">Billing</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Your plan and subscription.
        </p>
      </header>
      {/* Past-due alert is the authoritative, non-dismissible view
       *  of the same signal that powers the AppShell banner. The
       *  banner can be silenced for the session; this one can't -
       *  if the user navigated here they're already engaging with
       *  the issue. */}
      {isPastDue && (
        <div
          role="alert"
          className="border-b border-red-500/30 bg-red-500/10 px-5 py-3 text-xs text-red-900 dark:text-red-200"
        >
          <p className="font-medium">Payment failed on the last attempt.</p>
          <p className="mt-1 leading-snug">
            Stripe is retrying your card on its usual schedule. Update your
            payment method below to avoid losing premium access if the retries
            don&apos;t succeed.
          </p>
        </div>
      )}
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-baseline gap-2 text-sm">
            <span className="font-medium">
              {isPremium ? "AI Plus" : "Free"}
            </span>
            {subscriptionStatus && subscriptionStatus !== "active" && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {subscriptionStatus.replace(/_/g, " ")}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isPremium
              ? (renewalLabel ?? "Active subscription.")
              : "Free tier - limited monthly AI generations."}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {isPremium ? (
            <Button
              type="button"
              variant={isPastDue ? "default" : "outline"}
              size="sm"
              onClick={openPortal}
              disabled={portalBusy}
            >
              {portalBusy
                ? "Opening…"
                : isPastDue
                  ? "Update payment"
                  : "Manage subscription"}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => setUpgradeOpen(true)}
            >
              Upgrade
            </Button>
          )}
        </div>
      </div>

      {/* In-app billing surface - next charge, cancel/resume,
       *  invoice history. Self-hides for users without a Stripe
       *  customer (free-tier never-paid) so the section stays
       *  clean for them. Plan switch + payment-method update
       *  still go to the Stripe Portal via the button above. */}
      {isPremium && <BillingDetails />}

      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={(open) => {
          setUpgradeOpen(open);
          if (!open) refresh();
        }}
        reason="settings"
      />
    </section>
  );
}

/** App version + repo / bug-report shortcuts. Lives just above the
 *  destructive Delete-account section so it's the last benign panel in
 *  the page - easy to spot when someone scrolls all the way down to
 *  "check the version" without dragging eyes through dangerous controls. */
function AboutSection() {
  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <h3 className="text-sm font-semibold tracking-tight">About</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Build info and links to the source.
        </p>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-5 py-4 text-xs">
        <dt className="text-muted-foreground">Version</dt>
        <dd className="font-mono tabular-nums">v{APP_VERSION}</dd>
        <dt className="text-muted-foreground">Source</dt>
        <dd>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            github.com/hyp3rd/macro-calculator
          </a>
        </dd>
        <dt className="text-muted-foreground">Help</dt>
        <dd>
          <Link
            href="/help"
            className="underline-offset-2 hover:underline"
          >
            Help &amp; FAQ
          </Link>
        </dd>
      </dl>
    </section>
  );
}

/** Three-state form: closed → entering-email → verifying-code → closed.
 *  Matches the sign-in OTP UX (login/page.tsx) rather than relying on
 *  Supabase's magic-link, which is fragile cross-device (only works on
 *  the browser the request originated from). */
type ChangeEmailStage =
  | { kind: "closed" }
  | { kind: "request" }
  | { kind: "verify"; email: string };

function ChangeEmailSection({ currentEmail }: { currentEmail: string | null }) {
  const [stage, setStage] = useState<ChangeEmailStage>({ kind: "closed" });
  const [next, setNext] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setNext("");
    setCode("");
    setError(null);
    setStage({ kind: "closed" });
  }

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = next.trim().toLowerCase();
    if (!isLikelyEmail(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    if (trimmed === currentEmail?.toLowerCase()) {
      setError("That's already your current email.");
      return;
    }
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setError("Supabase isn't configured.");
      return;
    }
    setBusy(true);
    try {
      // `updateUser({ email })` triggers Supabase to send a confirmation
      // email containing both a link and (when the template includes
      // `{{ .Token }}`) an OTP code. We use the code path.
      const { error: e } = await supabase.auth.updateUser({ email: trimmed });
      if (e) throw e;
      setStage({ kind: "verify", email: trimmed });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send confirmation.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (stage.kind !== "verify") return;
    setError(null);
    const token = code.trim();
    if (!/^\d{4,10}$/.test(token)) {
      setError("Enter the numeric code from your email.");
      return;
    }
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setError("Supabase isn't configured.");
      return;
    }
    setBusy(true);
    try {
      // For an email-change confirmation, Supabase expects the *new*
      // email + the OTP from that inbox. On success the session's email
      // claim flips to the new address.
      const { error: e } = await supabase.auth.verifyOtp({
        email: stage.email,
        token,
        type: "email_change",
      });
      if (e) throw e;
      // Hard navigation so the proxy and every component see the new
      // session email on the very next request. Stay inside the app
      // rather than bouncing out to the marketing landing.
      window.location.assign("/app");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to verify code.");
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <h3 className="text-sm font-semibold tracking-tight">Email</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Change the address you sign in with.
        </p>
      </header>
      <div className="space-y-4 px-5 py-4">
        {stage.kind === "closed" && (
          <div className="flex items-center justify-between">
            <p className="text-sm">
              <span className="text-muted-foreground">Current:</span>{" "}
              <span className="font-medium text-foreground">
                {currentEmail ?? "-"}
              </span>
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setStage({ kind: "request" })}
              className="h-8 gap-1.5"
            >
              <Mail className="h-3.5 w-3.5" />
              Change
            </Button>
          </div>
        )}

        {stage.kind === "request" && (
          <form
            onSubmit={requestCode}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label
                htmlFor="new-email"
                className="text-xs font-medium text-muted-foreground"
              >
                New email
              </Label>
              <Input
                id="new-email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder="you@example.com"
                disabled={busy}
              />
            </div>
            {error && (
              <p
                role="alert"
                className="text-xs text-red-600"
              >
                {error}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={busy || !next.trim()}
                className="h-8"
              >
                {busy ? "Sending…" : "Email me a code"}
              </Button>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                disabled={busy}
                onClick={reset}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {stage.kind === "verify" && (
          <form
            onSubmit={verifyCode}
            className="space-y-3"
          >
            <div
              role="status"
              className="space-y-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs"
            >
              <div className="flex items-center gap-2 text-foreground">
                <Mail className="h-3.5 w-3.5" />
                <p className="font-medium">Code sent</p>
              </div>
              <p className="text-muted-foreground">
                Enter the numeric code we emailed to{" "}
                <span className="font-medium text-foreground">
                  {stage.email}
                </span>
                . The change takes effect as soon as you verify.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="email-change-code"
                className="text-xs font-medium text-muted-foreground"
              >
                Code
              </Label>
              <Input
                id="email-change-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d*"
                autoFocus
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 10))
                }
                placeholder="123456"
                disabled={busy}
                className="font-mono tracking-widest"
              />
            </div>
            {error && (
              <p
                role="alert"
                className="text-xs text-red-600"
              >
                {error}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={busy || !code.trim()}
                className="h-8"
              >
                {busy ? "Verifying…" : "Verify & change"}
              </Button>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                disabled={busy}
                onClick={reset}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

function DeleteAccountSection({
  userEmail,
  configured,
}: {
  userEmail: string | null;
  configured: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expected = (userEmail ?? "").trim().toLowerCase();
  const matches = expected !== "" && typed.trim().toLowerCase() === expected;

  function onOpenChange(next: boolean) {
    if (busy) return; // don't let the dialog close mid-delete
    setOpen(next);
    if (!next) {
      setTyped("");
      setError(null);
    }
  }

  async function confirm() {
    if (!matches) return;
    setError(null);
    setBusy(true);
    try {
      const res = await clientFetch("/api/delete-account", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      // Wipe the local cache so a future sign-in on this device starts
      // empty rather than re-uploading the deleted user's data.
      const supabase = getSupabaseBrowser();
      if (supabase) {
        await signOutAndClearLocal(supabase);
      } else {
        await clearAllStores();
      }
      // Hard navigation so the proxy sees the cleared cookies on the very
      // next request and the new page mounts with a fresh client.
      window.location.assign("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete account.");
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-red-500/30 bg-card">
      <header className="border-b border-red-500/30 bg-red-500/5 px-5 py-3">
        <h3 className="text-sm font-semibold tracking-tight text-red-700 dark:text-red-400">
          Delete account
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Permanently removes your account and all synced data. Can&apos;t be
          undone.
        </p>
      </header>
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <p className="text-xs text-muted-foreground">
          We&apos;ll delete your profile, daily logs, weight history, custom
          foods, and meal templates from Supabase, plus everything saved on this
          device.
        </p>
        <AlertDialog
          open={open}
          onOpenChange={onOpenChange}
        >
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1.5 border-red-500/40 text-red-700 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this account?</AlertDialogTitle>
              <AlertDialogDescription>
                This is permanent. Your Supabase account and all synced data
                will be deleted; your local data on this device will also be
                wiped.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5 pt-2">
              <Label
                htmlFor="confirm-email"
                className="text-xs font-medium text-muted-foreground"
              >
                Type{" "}
                <span className="font-mono text-foreground">
                  {userEmail ?? "your email"}
                </span>{" "}
                to confirm
              </Label>
              <Input
                id="confirm-email"
                type="email"
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                disabled={busy}
                placeholder={userEmail ?? ""}
              />
              {!configured && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Supabase isn&apos;t configured on this build - deletion will
                  fail.
                </p>
              )}
              {error && (
                <p
                  role="alert"
                  className="text-xs text-red-600"
                >
                  {error}
                </p>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault(); // keep the dialog open until we navigate
                  confirm();
                }}
                disabled={!matches || busy}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {busy ? "Deleting…" : "Delete account"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
}

/** Surfaces the caller's monthly AI-call usage against the free-tier
 *  cap. Hidden for guests (no usage to show), collapsed to a one-line
 *  unmetered note for premium users, and rendered as a progress bar
 *  + counter for free users. A "near cap" warning fires at 80% used
 *  so the user has a chance to upgrade before they're locked out
 *  mid-task. The actual upgrade flow doesn't exist yet - when Stripe
 *  lands, the "Upgrade" button targets that route. */
function AiUsageSection() {
  const { state: usage, refresh } = useAiUsage();

  if (usage.status === "anon" || usage.status === "loading") return null;
  if (usage.status === "error") return null;

  const data = usage.data;
  const cap = data.cap;
  const pct = cap ? Math.min(100, Math.round((data.used / cap) * 100)) : 0;
  const nearCap = cap !== null && data.used >= Math.floor(cap * 0.8);
  const atCap = cap !== null && data.used >= cap;

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border/60 px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">AI usage</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            AI features (Auto-fill meal plans, Generate recipes, Identify meal
            photos) share one monthly quota.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={refresh}
          className="h-8 shrink-0 text-xs text-muted-foreground"
          title="Re-fetch the current counter from the server"
        >
          Refresh
        </Button>
      </header>

      <div className="px-5 py-4">
        {data.isPremium || cap === null ? (
          <p className="text-sm text-foreground">
            <span className="font-medium">Premium</span> - AI features are
            unmetered on your account.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm">
                <span className="font-mono font-medium tabular-nums">
                  {data.used} / {cap}
                </span>{" "}
                <span className="text-muted-foreground">
                  AI calls this month
                </span>
              </p>
              <p
                className={`text-xs tabular-nums ${
                  atCap
                    ? "text-rose-600 dark:text-rose-400"
                    : nearCap
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-muted-foreground"
                }`}
              >
                {atCap
                  ? "Cap reached"
                  : nearCap
                    ? `${cap - data.used} left`
                    : `${pct}%`}
              </p>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                  atCap
                    ? "bg-rose-500"
                    : nearCap
                      ? "bg-amber-500"
                      : "bg-foreground"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Resets the 1st of each month. When you hit the cap, the app falls
              back to the deterministic planner for meal generation and disables
              AI photo identification + recipe generation until the next cycle.
              Manual entry, barcode-scan, and OFF search keep working.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/** Notification preferences - two boolean toggles for the daily
 *  reminder + weekly recap emails. State + writes flow through
 *  `useNotificationPrefs`, which optimistically updates the
 *  toggles and reverts on a failed upsert. Hidden entirely for
 *  guest users and for Supabase-unconfigured builds - there's no
 *  meaningful row to read or write in either case. */
/** Display preference for weight + height across the app. Storage
 *  stays metric (kg / cm) regardless — flipping this is a pure
 *  presentation change, no data migration. */
function UnitsSection({
  units,
  onChange,
}: {
  units: UnitSystem;
  onChange: (next: UnitSystem) => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <h3 className="text-sm font-semibold tracking-tight">Units</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          How weight + height are shown. The math behind BMR / TDEE always runs
          in metric; this is a display preference only, so flipping it never
          changes your saved values.
        </p>
      </header>
      <div className="px-5 py-4">
        <div
          role="radiogroup"
          aria-label="Display unit system"
          className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background p-0.5 text-xs"
        >
          <UnitRadio
            active={units === "metric"}
            onClick={() => onChange("metric")}
            label="Metric"
            sub="kg / cm"
          />
          <UnitRadio
            active={units === "imperial"}
            onClick={() => onChange("imperial")}
            label="Imperial"
            sub="lb / ft·in"
          />
        </div>
      </div>
    </section>
  );
}

function UnitRadio({
  active,
  onClick,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`inline-flex flex-col items-center gap-0 rounded px-3 py-1.5 transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[10px] opacity-70">{sub}</span>
    </button>
  );
}

function NotificationsSection() {
  const { state, update } = useNotificationPrefs();

  if (state.status === "loading") {
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <header className="border-b border-border/60 px-5 py-3">
          <h3 className="text-sm font-semibold tracking-tight">
            Email notifications
          </h3>
        </header>
        <div className="space-y-2 px-5 py-4">
          <div className="h-3 w-40 animate-pulse rounded bg-muted" />
          <div className="h-3 w-48 animate-pulse rounded bg-muted/50" />
        </div>
      </section>
    );
  }
  if (state.status === "anon" || state.status === "unconfigured") {
    return null;
  }
  if (state.status === "error") {
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <header className="border-b border-border/60 px-5 py-3">
          <h3 className="text-sm font-semibold tracking-tight">
            Email notifications
          </h3>
        </header>
        <div className="px-5 py-4 text-xs text-rose-700 dark:text-rose-400">
          Couldn&apos;t load preferences: {state.message}
        </div>
      </section>
    );
  }

  const { dailyReminder, weeklyRecap, pushEnabled, reminderHour, timezone } =
    state.data;

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <h3 className="text-sm font-semibold tracking-tight">
          Email notifications
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Two transactional emails, both opt-in. We never send anything else.
        </p>
      </header>
      <div className="divide-y divide-border/60">
        <NotificationToggle
          title="Daily reminder"
          description="Once a day, only if you haven't logged anything yet. Skips silently when you've already logged a meal."
          checked={dailyReminder}
          onChange={(v) => void update({ dailyReminder: v })}
        />
        {dailyReminder && (
          <div className="space-y-3 bg-muted/20 px-5 py-4">
            <div className="flex flex-col gap-1">
              <Label
                htmlFor="reminder-hour"
                className="text-xs font-medium text-muted-foreground"
              >
                Reminder time
              </Label>
              <select
                id="reminder-hour"
                value={reminderHour}
                onChange={(e) =>
                  void update({
                    reminderHour: Number.parseInt(e.target.value, 10),
                  })
                }
                className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-32"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option
                    key={h}
                    value={h}
                  >
                    {h.toString().padStart(2, "0")}:00
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                Local time in{" "}
                <span className="font-mono">{timezone ?? "UTC"}</span>. The cron
                picks this up within an hour.
              </p>
            </div>
          </div>
        )}
        <NotificationToggle
          title="Weekly recap"
          description="Monday morning summary of the previous 7 days - averages, on-target days, weight change. Skipped if you logged nothing that week."
          checked={weeklyRecap}
          onChange={(v) => void update({ weeklyRecap: v })}
        />
        <PushToggleRow
          checked={pushEnabled}
          dailyReminder={dailyReminder}
          onChange={async (next) => {
            // The DB flag and the browser subscription must move
            // together. Enable: subscribe at the OS layer first, then
            // flip the DB flag - failure on either side leaves us
            // consistent (either both off, or no DB write). Disable:
            // mirror by tearing down OS-side first.
            if (next) {
              const { enablePush } = await import("@/lib/push/client");
              const res = await enablePush();
              if (!res.ok) {
                toast.error(res.reason ?? "Couldn't enable push.");
                return;
              }
              await update({ pushEnabled: true });
              toast.success("Push notifications enabled on this device.");
            } else {
              const { disablePush } = await import("@/lib/push/client");
              await disablePush();
              await update({ pushEnabled: false });
              toast.success("Push notifications disabled.");
            }
          }}
        />
      </div>
    </section>
  );
}

/** Push toggle. Adds a hint about platform requirements (iOS Safari
 *  needs the PWA installed, browsers need permission) and disables
 *  itself when the daily-reminder channel is off - sending push
 *  with the email channel disabled would silently send the OS-level
 *  notification without the user expecting anything from us, which
 *  is exactly the consent surprise we're trying to avoid. */
function PushToggleRow({
  checked,
  dailyReminder,
  onChange,
}: {
  checked: boolean;
  dailyReminder: boolean;
  onChange: (next: boolean) => void | Promise<void>;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);

  // Browser support is read once on mount via a side effect - calling
  // `isPushSupported()` during render would touch window globals and
  // mismatch hydration on the server-rendered first paint.
  useEffect(() => {
    let active = true;
    void import("@/lib/push/client").then(({ isPushSupported }) => {
      if (active) setSupported(isPushSupported());
    });
    return () => {
      active = false;
    };
  }, []);

  // Subscribing requires the daily-reminder channel + browser
  // support (consent surprise prevention). Unsubscribing only
  // requires browser support — and, in practice, succeeds even on
  // an unsupported browser because the DB flag still flips (the
  // SW-side teardown becomes a no-op). Previously this row was
  // `disabled` whenever `dailyReminder` was off, which trapped any
  // user who'd subscribed in the past, then turned off the daily
  // reminder, and couldn't see a way back out.
  const canSubscribe = supported !== false && dailyReminder;
  const disabled = checked ? supported === false : !canSubscribe;
  const description = checked
    ? "On for this device — uncheck to stop receiving system notifications here. The daily reminder channel above can stay off independently."
    : !dailyReminder
      ? "Enable the daily reminder above first — push reuses the same trigger."
      : supported === false
        ? "This browser doesn't support push notifications. On iOS, install the PWA first (Share → Add to Home Screen)."
        : "Same nudge as the email, but as a system notification. You'll be asked for permission the first time you enable.";

  return (
    <label
      className={`flex items-start gap-3 px-5 py-4 transition-colors ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-accent/30"}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => void onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-foreground disabled:cursor-not-allowed"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium tracking-tight">
          Browser push notifications
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </label>
  );
}

/** Single labelled switch-style toggle row. Built on the existing
 *  checkbox primitive for keyboard / screen-reader parity with the
 *  rest of the form controls in the app - visually closer to a
 *  switch via the wrapping label's affordances. */
function NotificationToggle({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 px-5 py-4 transition-colors hover:bg-accent/30">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-foreground"
        aria-label={title}
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </label>
  );
}
