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
import { SkeletonSettingRows } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
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
import {
  decryptExport,
  encryptExport,
  isEncryptedEnvelope,
  type EncryptedEnvelope,
} from "@/lib/export-crypto";
import { planImport, type ImportPlan } from "@/lib/import";
import { GITHUB_REPO_URL } from "@/lib/links";
import { MARKETS, type MarketCode } from "@/lib/markets";
import { scrollIntoViewUntilStable } from "@/lib/scroll-into-view";
import { consumeSettingsScroll } from "@/lib/settings-anchor";
import {
  downloadExport as downloadCloudExport,
  uploadExport,
} from "@/lib/storage/exports";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import {
  MAX_INTERVAL_MIN,
  MIN_INTERVAL_MIN,
  setAutoSaveInterval,
  setSyncMode,
  useSyncMode,
  type SyncMode,
} from "@/lib/sync-mode";
import type { UnitSystem } from "@/lib/units";
import { APP_VERSION } from "@/lib/version";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { CloudExportsList } from "./CloudExportsList";
import { ConnectedAccountsSection } from "./ConnectedAccountsSection";
import { ImportPreviewDialog } from "./ImportPreviewDialog";
import { MfaSection } from "./MfaSection";
import { PasskeysSection } from "./PasskeysSection";
import { PassphraseDialog } from "./PassphraseDialog";
import { SecurityOverview } from "./SecurityOverview";
import { SignedInDevicesSection } from "./SignedInDevicesSection";
import { TrustedDevicesSection } from "./TrustedDevicesSection";
import { SecurityStatusProvider } from "./security-status";

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

/** A small uppercase divider that labels a run of related settings cards
 *  (Security, App settings, Danger zone). Single-card groups (Account, Your
 *  data, About) are self-named by the card's own header, so they get no
 *  divider. The extra `pt-2` widens the gap *above* the label so each group
 *  reads as separated from the one before it. */
function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

/** Props injected by the parent (`macro-calculator.tsx`). Settings
 *  doesn't run its own profile state — that would create a second
 *  `useProfile` instance and double-up the debounced writes. The
 *  parent owns the profile; SettingsView only takes the slice it
 *  needs (units) and a setter that goes through `patchProfile`. */
export function SettingsView({
  units,
  onUnitsChange,
  homeMarket,
  onHomeMarketChange,
}: {
  units: UnitSystem;
  onUnitsChange: (next: UnitSystem) => void;
  homeMarket: MarketCode | undefined;
  onHomeMarketChange: (next: MarketCode | undefined) => void;
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

  // Passphrase prompt for zero-knowledge export encryption. The resolver ref
  // hands the entered passphrase back to the awaiting upload/restore handler;
  // it's never stored, only passed straight to the in-memory crypto call.
  const [passphrasePrompt, setPassphrasePrompt] = useState<{
    mode: "encrypt" | "decrypt";
    error: string | null;
    busy: boolean;
  } | null>(null);
  // Bumped on every prompt so the dialog remounts with fresh (empty) fields —
  // see PassphraseDialog's reset-via-key note.
  const [passphrasePromptId, setPassphrasePromptId] = useState(0);
  const passphraseResolver = useRef<((value: string | null) => void) | null>(
    null,
  );

  /** Open the passphrase dialog; resolves with the submitted passphrase, or
   *  null if the user cancels. Submitting marks the dialog busy so the
   *  caller's crypto runs with the controls disabled. */
  function askPassphrase(
    mode: "encrypt" | "decrypt",
    error: string | null = null,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      passphraseResolver.current = resolve;
      setPassphrasePromptId((n) => n + 1);
      setPassphrasePrompt({ mode, error, busy: false });
    });
  }
  function submitPassphrase(value: string) {
    setPassphrasePrompt((p) => (p ? { ...p, busy: true, error: null } : p));
    const resolve = passphraseResolver.current;
    passphraseResolver.current = null;
    resolve?.(value);
  }
  function cancelPassphrase() {
    setPassphrasePrompt(null);
    const resolve = passphraseResolver.current;
    passphraseResolver.current = null;
    resolve?.(null);
  }

  /** Decrypt an envelope, re-prompting on a wrong passphrase until it works or
   *  the user cancels. Returns the plaintext, or null on cancel. */
  async function decryptWithPrompt(
    envelope: EncryptedEnvelope,
  ): Promise<string | null> {
    let pass = await askPassphrase("decrypt");
    for (;;) {
      if (pass === null) {
        setPassphrasePrompt(null);
        return null;
      }
      try {
        const plaintext = await decryptExport(envelope, pass);
        setPassphrasePrompt(null);
        return plaintext;
      } catch (e) {
        pass = await askPassphrase(
          "decrypt",
          e instanceof Error ? e.message : "Wrong passphrase.",
        );
      }
    }
  }

  /** Parse import text, transparently decrypting an encrypted envelope (with a
   *  passphrase prompt). Returns the parsed bundle, or null if the user
   *  cancelled the prompt. Throws on malformed JSON. */
  async function decodeImportText(text: string): Promise<unknown | null> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Not valid JSON.");
    }
    if (isEncryptedEnvelope(parsed)) {
      const plaintext = await decryptWithPrompt(parsed);
      if (plaintext === null) return null;
      try {
        return JSON.parse(plaintext);
      } catch {
        throw new Error("Decrypted data isn't valid JSON.");
      }
    }
    return parsed;
  }

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
      // Zero-knowledge: encrypt the bundle on this device before upload so the
      // bucket only ever holds ciphertext. Cancelling the passphrase prompt
      // aborts the upload.
      const passphrase = await askPassphrase("encrypt");
      if (passphrase === null) {
        setPassphrasePrompt(null);
        return;
      }
      const envelope = await encryptExport(JSON.stringify(bundle), passphrase);
      setPassphrasePrompt(null);
      // `exportedAt` rides in the clear so the bucket listing + filename keep
      // working; everything sensitive is inside `ciphertext`.
      await uploadExport(supabase, user.id, {
        ...envelope,
        exportedAt: bundle.exportedAt,
      });
      // Bumps the CloudExportsList refreshKey so it pulls the new entry.
      setCloudRefreshKey((k) => k + 1);
      toast.success("Backup saved to cloud.");
    } catch (e) {
      // buildWithProgress sets exportError on its failures; the encrypt /
      // upload calls can also fail with their own message.
      setPassphrasePrompt(null);
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
      const text = await file.text();
      // Decrypts transparently (with a passphrase prompt) if the file is an
      // encrypted backup; returns null if the user cancels the prompt.
      const raw = await decodeImportText(text);
      if (raw === null) return;
      const plan = await planImport(raw);
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
      // Cloud backups are encrypted — decrypt transparently (passphrase
      // prompt). null means the user cancelled the prompt.
      const raw = await decodeImportText(text);
      if (raw === null) return;
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

      {/* Security — everything here needs an account, so the whole group
          (label included) is gated; a guest never sees an empty heading.
          Backup email lives INSIDE this group (it's account recovery), after
          the two sign-in protections it backstops. The provider lets the
          overview card summarize each section's status without re-fetching. */}
      {user && (
        <SecurityStatusProvider>
          <GroupLabel>Security</GroupLabel>
          <SecurityOverview />
          <MfaSection signedIn={Boolean(user)} />
          <PasskeysSection signedIn={Boolean(user)} />
          <BackupEmailSection signedIn={Boolean(user)} />
          <TrustedDevicesSection signedIn={Boolean(user)} />
          <ConnectedAccountsSection signedIn={Boolean(user)} />
          <SignedInDevicesSection signedIn={Boolean(user)} />
        </SecurityStatusProvider>
      )}

      <GroupLabel>App settings</GroupLabel>
      <UnitsSection
        units={units}
        onChange={onUnitsChange}
      />
      <MarketSection
        homeMarket={homeMarket}
        onChange={onHomeMarketChange}
      />
      {user && <NotificationsSection />}
      {user && <SyncSection />}

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

      <PassphraseDialog
        key={passphrasePromptId}
        open={passphrasePrompt !== null}
        mode={passphrasePrompt?.mode ?? "decrypt"}
        error={passphrasePrompt?.error}
        busy={passphrasePrompt?.busy}
        onSubmit={submitPassphrase}
        onCancel={cancelPassphrase}
      />

      <AboutSection />

      <GroupLabel>Danger zone</GroupLabel>
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
            github.com/hyp3rd/maqro
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

/** Synced "home market" — the shopping country the food search biases Open
 *  Food Facts toward, overriding the browser-region default. Persisted in the
 *  profile (so it follows the user across devices); a per-device override from
 *  the search-bar switcher still wins locally. */
function MarketSection({
  homeMarket,
  onChange,
}: {
  homeMarket: MarketCode | undefined;
  onChange: (next: MarketCode | undefined) => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <h3 className="text-sm font-semibold tracking-tight">
          Shopping market
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Which country&apos;s products the food search prefers, via Open Food
          Facts. Syncs across your devices; you can still switch it on the go
          from the search bar. Defaults to your browser region.
        </p>
      </header>
      <div className="px-5 py-4">
        <select
          aria-label="Home shopping market"
          value={homeMarket ?? ""}
          onChange={(e) =>
            onChange(
              e.target.value === ""
                ? undefined
                : (e.target.value as MarketCode),
            )
          }
          className="h-10 w-full max-w-xs rounded-md border border-border/60 bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Automatic (browser region)</option>
          {MARKETS.map((m) => (
            <option
              key={m.code}
              value={m.code}
            >
              {m.name}
            </option>
          ))}
        </select>
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

const SYNC_MODE_OPTIONS: {
  value: SyncMode;
  label: string;
  description: string;
}[] = [
  {
    value: "local-first",
    label: "Local-first",
    description:
      "Keep edits on this device and save manually. We'll gently remind you if you forget. Most private; nothing leaves until you say so.",
  },
  {
    value: "auto-save",
    label: "Auto-save",
    description:
      "Push automatically on a timer while you have unsaved changes — set the interval below.",
  },
  {
    value: "remote-only",
    label: "Always sync",
    description:
      "Push shortly after every change so your account stays current on all your devices. Simplest — you never think about saving.",
  },
];

/** Per-device sync-behaviour picker. Stored in localStorage (a device
 *  preference, not synced) via `lib/sync-mode`; the SyncModeController
 *  reads the same store to drive auto-save / remote-only / the
 *  local-first reminder. */
function SyncSection() {
  const { mode, intervalMinutes } = useSyncMode();
  const ref = useRef<HTMLElement>(null);

  // When Settings was opened from the topbar sync chip, scroll this
  // section into view — and keep it pinned while the sections above
  // (connected devices, passkeys, MFA) finish loading and grow, which
  // would otherwise push the target out from under a one-shot scroll.
  useEffect(() => {
    if (consumeSettingsScroll() !== "sync") return;
    const el = ref.current;
    if (!el) return;
    return scrollIntoViewUntilStable(el);
  }, []);

  return (
    <section
      ref={ref}
      className="scroll-mt-4 overflow-hidden rounded-lg border border-border/60 bg-card"
    >
      <header className="border-b border-border/60 px-5 py-3">
        <h3 className="text-sm font-semibold tracking-tight">Sync</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          How this device uploads your changes to your account. A per-device
          preference — it changes <em>when</em> data syncs, never the data
          itself.
        </p>
      </header>
      <div
        role="radiogroup"
        aria-label="Sync mode"
        className="divide-y divide-border/60"
      >
        {SYNC_MODE_OPTIONS.map((opt) => {
          const active = mode === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setSyncMode(opt.value)}
              className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  active ? "border-foreground" : "border-input"
                }`}
              >
                {active && (
                  <span className="h-2 w-2 rounded-full bg-foreground" />
                )}
              </span>
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="block text-sm font-medium text-foreground">
                  {opt.label}
                </span>
                <span className="block text-xs leading-relaxed text-muted-foreground">
                  {opt.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {mode === "auto-save" && (
        <div className="space-y-2 border-t border-border/60 px-5 py-4">
          <div className="flex items-baseline justify-between">
            <Label className="text-xs font-medium text-muted-foreground">
              Save every
            </Label>
            <span className="font-mono text-sm tabular-nums text-foreground">
              {intervalMinutes} min
            </span>
          </div>
          <Slider
            value={[intervalMinutes]}
            min={MIN_INTERVAL_MIN}
            max={MAX_INTERVAL_MIN}
            step={1}
            onValueChange={([v]) => {
              if (typeof v === "number") setAutoSaveInterval(v);
            }}
            aria-label="Auto-save interval in minutes"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground/70">
            <span>{MIN_INTERVAL_MIN} min</span>
            <span>{MAX_INTERVAL_MIN} min</span>
          </div>
        </div>
      )}
    </section>
  );
}

function NotificationsSection() {
  const { state, update } = useNotificationPrefs();

  if (state.status === "loading") {
    // Match the loaded header (incl. the description line) and reserve the
    // three toggle rows, so the card keeps its size when prefs arrive.
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
        <SkeletonSettingRows rows={3} />
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
                <span className="font-mono">{timezone ?? "UTC"}</span>. Your
                reminders use this within an hour.
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
            // mirror by tearing down OS-side first. The success toasts
            // are gated on update()'s result — a failed upsert reverts
            // the toggle, and claiming success then would lie. The
            // try/catch covers the dynamic import + any escape from the
            // push helpers; without it the rejection of this voided
            // handler vanishes and the toggle silently does nothing.
            try {
              if (next) {
                const { enablePush } = await import("@/lib/push/client");
                const res = await enablePush();
                if (!res.ok) {
                  toast.error(res.reason ?? "Couldn't enable push.");
                  return;
                }
                if (await update({ pushEnabled: true })) {
                  toast.success("Push notifications enabled on this device.");
                }
              } else {
                const { disablePush } = await import("@/lib/push/client");
                await disablePush();
                if (await update({ pushEnabled: false })) {
                  toast.success("Push notifications disabled.");
                }
              }
            } catch {
              toast.error("Couldn't update push notifications. Try again.");
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
