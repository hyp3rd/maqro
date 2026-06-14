"use client";

import { PasteOtpButton } from "@/components/auth/PasteOtpButton";
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
import { clientFetch } from "@/lib/auth/client-fetch";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import * as React from "react";
import { CheckCircle2, LifeBuoy, Mail, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useReportSecurityStatus } from "./security-status";

/** Settings → Backup email. Lifecycle UI for the lost-email
 *  recovery feature shipped in migration 0029.
 *
 *  Three discrete states the section can be in:
 *
 *    - **idle** - user has no backup, no pending verification.
 *      Renders an input + "Send code" button.
 *    - **pending** - user submitted a candidate; an OTP is in
 *      flight. Renders a 6-digit code input + Verify + Resend.
 *    - **verified** - backup is set. Renders the address with a
 *      "Remove" affordance (confirms via AlertDialog).
 *
 *  Reads its own state from `profiles` (RLS allows self-select).
 *  Writes go through the three `/api/account/backup-email/*`
 *  routes, which use the service-role client. */

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ok";
      backupEmail: string | null;
      verifiedAt: string | null;
      pending: string | null;
      pendingExpiresAt: string | null;
    }
  | { kind: "error"; message: string };

/** Thin `signedIn` gate around `BackupEmailSectionBody`. The first-time
 *  explainer now lives once at the top of the Security group (`SecurityIntro`)
 *  instead of per section. */
export function BackupEmailSection({ signedIn }: { signedIn: boolean }) {
  if (!signedIn) return null;
  return <BackupEmailSectionBody signedIn={signedIn} />;
}

function BackupEmailSectionBody({ signedIn }: { signedIn: boolean }) {
  const [load, setLoad] = React.useState<LoadState>({ kind: "loading" });
  const [emailInput, setEmailInput] = React.useState("");
  const [codeInput, setCodeInput] = React.useState("");
  const [busy, setBusy] = React.useState<
    "idle" | "sending" | "verifying" | "removing"
  >("idle");
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    type ProfileBackupRow = {
      backup_email: string | null;
      backup_email_verified_at: string | null;
      backup_email_pending: string | null;
      backup_email_code_expires_at: string | null;
    };
    supabase.auth.getUser().then(async ({ data: userData }) => {
      if (cancelled) return;
      const userId = userData.user?.id;
      if (!userId) {
        setLoad({ kind: "error", message: "Not signed in." });
        return;
      }
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "backup_email, backup_email_verified_at, backup_email_pending, backup_email_code_expires_at",
        )
        .eq("user_id", userId)
        .maybeSingle<ProfileBackupRow>();
      if (cancelled) return;
      if (error) {
        setLoad({ kind: "error", message: error.message });
        return;
      }
      setLoad({
        kind: "ok",
        backupEmail: data?.backup_email ?? null,
        verifiedAt: data?.backup_email_verified_at ?? null,
        pending: data?.backup_email_pending ?? null,
        pendingExpiresAt: data?.backup_email_code_expires_at ?? null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, tick]);

  // Publish backup-email status up to the Security overview card (boolean
  // primitives keep the effect from re-firing on unrelated re-renders).
  const reportSecurity = useReportSecurityStatus();
  const backupVerified = load.kind === "ok" ? Boolean(load.verifiedAt) : null;
  const backupPending = load.kind === "ok" ? Boolean(load.pending) : null;
  React.useEffect(() => {
    if (backupVerified === null) return;
    reportSecurity(
      "backupEmail",
      backupVerified
        ? { value: "Set", tone: "good" }
        : backupPending
          ? { value: "Pending", tone: "muted" }
          : { value: "Not set", tone: "muted" },
    );
  }, [backupVerified, backupPending, reportSecurity]);

  function refresh() {
    setTick((t) => t + 1);
  }

  async function sendCode() {
    setBusy("sending");
    try {
      const res = await clientFetch("/api/account/backup-email/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailInput.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        masked?: string;
      };
      if (!res.ok) {
        toast.error(body.error ?? `Couldn't send code (${res.status}).`);
        return;
      }
      toast.success(`Code sent to ${body.masked ?? "your backup inbox"}.`);
      setEmailInput("");
      setCodeInput("");
      refresh();
    } finally {
      setBusy("idle");
    }
  }

  async function verifyCode() {
    setBusy("verifying");
    try {
      const res = await clientFetch("/api/account/backup-email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeInput.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        backupEmail?: string;
      };
      if (!res.ok) {
        toast.error(body.error ?? `Couldn't verify (${res.status}).`);
        return;
      }
      toast.success("Backup email verified.");
      setCodeInput("");
      refresh();
    } finally {
      setBusy("idle");
    }
  }

  async function removeBackup() {
    setBusy("removing");
    try {
      const res = await clientFetch("/api/account/backup-email", {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? `Couldn't remove (${res.status}).`);
        return;
      }
      toast.success("Backup email removed.");
      refresh();
    } finally {
      setBusy("idle");
    }
  }

  if (!signedIn) return null;

  // Render shells first so the section's outline doesn't jump
  // around between load / verified / pending.
  const header = (
    <header className="border-b border-border/60 px-5 py-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <LifeBuoy className="h-4 w-4 text-muted-foreground" />
        Backup email
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        A second address we&apos;ll send a one-shot sign-in link to if you ever
        lose access to your primary inbox. Used only for recovery.
      </p>
    </header>
  );

  if (load.kind === "loading") {
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {header}
        <SkeletonSettingRows rows={2} />
      </section>
    );
  }
  if (load.kind === "error") {
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {header}
        <p
          role="alert"
          className="px-5 py-4 text-xs text-red-600"
        >
          {load.message}
        </p>
      </section>
    );
  }

  // Verified branch - show the address + remove control.
  if (load.backupEmail && load.verifiedAt) {
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {header}
        <div className="flex animate-in flex-col gap-3 px-5 py-4 fade-in duration-300 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="font-medium">{load.backupEmail}</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Verified
            </span>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy === "removing"}
                className="h-8 shrink-0 gap-1.5 self-start sm:self-auto"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove backup email?</AlertDialogTitle>
                <AlertDialogDescription>
                  Without a backup, the lost-email recovery flow won&apos;t work
                  - if you ever lose access to your primary inbox you&apos;ll
                  have to contact support. You can set a new one any time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy === "removing"}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    void removeBackup();
                  }}
                  disabled={busy === "removing"}
                >
                  {busy === "removing" ? "Removing…" : "Remove"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </section>
    );
  }

  // Pending branch - show the code input + Resend. We deliberately
  // do NOT compute "is the code expired right now" at render time -
  // `Date.now()` is impure for react-hooks/purity, and the server
  // route enforces expiry authoritatively. If the user submits a
  // stale code, the verify route returns 400 with a toast prompting
  // a resend; that's the correct authoritative gate.
  if (load.pending) {
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {header}
        <div className="space-y-3 px-5 py-4">
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            <span>
              Code sent to{" "}
              <span className="font-medium text-foreground">
                {load.pending}
              </span>
              . Paste it below.
            </span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label
                htmlFor="backup-code"
                className="text-xs font-medium text-muted-foreground"
              >
                6-digit code
              </Label>
              <div className="relative">
                <Input
                  id="backup-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={codeInput}
                  onChange={(e) =>
                    setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  onPaste={(e) => {
                    // Bypass maxLength so a code copied with
                    // surrounding whitespace isn't silently truncated
                    // before our regex strips the whitespace. Same
                    // shape as the TOTP inputs.
                    e.preventDefault();
                    const pasted = e.clipboardData
                      .getData("text")
                      .replace(/\D/g, "")
                      .slice(0, 6);
                    if (pasted) setCodeInput(pasted);
                  }}
                  placeholder="••••••"
                  className="pr-10 font-mono tabular-nums tracking-[0.3em] text-center"
                  disabled={busy !== "idle"}
                />
                <PasteOtpButton
                  onPaste={setCodeInput}
                  disabled={busy !== "idle"}
                />
              </div>
            </div>
            <Button
              type="button"
              onClick={() => void verifyCode()}
              disabled={codeInput.length !== 6 || busy !== "idle"}
              className="h-9 shrink-0"
            >
              {busy === "verifying" ? "Verifying…" : "Verify"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => {
                setEmailInput(load.pending ?? "");
                setCodeInput("");
                void sendCode();
              }}
              disabled={busy !== "idle"}
            >
              Resend the code
            </button>
            <span className="text-muted-foreground">·</span>
            <button
              type="button"
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => {
                // Optimistic "use a different email" - clear the
                // pending state by submitting a fresh empty start
                // would be wasteful. Just blank the candidate inline
                // so the idle branch renders next.
                void removeBackup();
              }}
              disabled={busy !== "idle"}
            >
              Cancel and use a different email
            </button>
          </div>
        </div>
      </section>
    );
  }

  // Idle branch - input + Send code.
  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      {header}
      <div className="animate-in space-y-3 px-5 py-4 fade-in duration-300">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label
              htmlFor="backup-email"
              className="text-xs font-medium text-muted-foreground"
            >
              Email address
            </Label>
            <Input
              id="backup-email"
              type="email"
              autoComplete="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="you-elsewhere@example.com"
              disabled={busy !== "idle"}
            />
          </div>
          <Button
            type="button"
            onClick={() => void sendCode()}
            disabled={!emailInput.trim() || busy !== "idle"}
            className="h-9 shrink-0"
          >
            {busy === "sending" ? "Sending…" : "Send code"}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          We&apos;ll send a 6-digit code there. The address only gets used for
          recovery sign-in links - never for marketing or product email.
        </p>
      </div>
    </section>
  );
}
