"use client";

import { TotpCodeInput } from "@/components/auth/TotpCodeInput";
import { Footer } from "@/components/shell/Footer";
import { Button } from "@/components/ui/button";
import { getVerifiedTotpFactorId } from "@/lib/auth/mfa-factors";
import { useTotpChallenge } from "@/lib/auth/use-totp-challenge";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

/** Lost-authenticator step-down, landed on from the backup-email recovery link
 *  (which signs the user in at AAL1 and redirects here with `?rt=<grant>`).
 *
 *  Serves both recovery cases: someone who lost their EMAIL but still has their
 *  authenticator just enters their code (normal step-up → AAL2 → app); someone
 *  who lost their AUTHENTICATOR removes two-step verification via the
 *  grant-gated `/api/account/mfa/recover-unenroll` route, then re-enrolls. The
 *  removal is the only privileged action and is gated server-side by the `rt`
 *  grant — a bare AAL1 session can never strip 2FA. */
export default function RecoverPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </Shell>
      }
    >
      <RecoverInner />
    </Suspense>
  );
}

type Load =
  | { kind: "loading" }
  | { kind: "no-session" }
  | { kind: "no-factor" }
  | { kind: "factor"; factorId: string };

function RecoverInner() {
  const searchParams = useSearchParams();
  // Capture `rt` ONCE, then strip it from the visible URL so the single-use
  // token doesn't linger in browser history / server access logs. Held in state
  // so the strip can't lose it.
  const [rt] = useState(() => searchParams.get("rt") ?? "");
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    if (rt && typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [rt]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = getSupabaseBrowser();
      if (!supabase) {
        if (!cancelled) setLoad({ kind: "no-session" });
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setLoad({ kind: "no-session" });
        return;
      }
      const factorId = await getVerifiedTotpFactorId(supabase);
      if (cancelled) return;
      setLoad(factorId ? { kind: "factor", factorId } : { kind: "no-factor" });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Shell>
      {load.kind === "loading" && (
        <p className="text-sm text-muted-foreground">Checking your account…</p>
      )}
      {load.kind === "no-session" && <NoSession />}
      {load.kind === "no-factor" && <SignedInNoFactor />}
      {load.kind === "factor" && (
        <FactorRecovery
          factorId={load.factorId}
          rt={rt}
        />
      )}
    </Shell>
  );
}

function NoSession() {
  return (
    <div className="space-y-3">
      <p className="text-sm">
        This recovery link didn&apos;t sign you in — it may have already been
        used or expired.
      </p>
      <Button
        asChild
        className="w-full"
      >
        <Link href="/login/recovery">Request a new recovery link</Link>
      </Button>
    </div>
  );
}

function SignedInNoFactor() {
  return (
    <div className="space-y-3">
      <p className="text-sm">You&apos;re signed in. Nothing else to do here.</p>
      <Button
        asChild
        className="w-full"
      >
        <Link href="/app">Continue to Maqro</Link>
      </Button>
    </div>
  );
}

function FactorRecovery({ factorId, rt }: { factorId: string; rt: string }) {
  const [mode, setMode] = useState<"have" | "lost">("have");
  const { code, setCode, busy, error, submit } = useTotpChallenge({
    factorId,
    onVerified: () => window.location.assign("/app"),
  });
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function removeAuthenticator() {
    setRemoveError(null);
    if (!rt) {
      setRemoveError(
        "This link can't remove your authenticator. Request a fresh recovery link and try again.",
      );
      return;
    }
    setRemoving(true);
    try {
      const res = await fetch("/api/account/mfa/recover-unenroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rt }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setRemoveError(
          body.error ??
            "Couldn't remove it. Request a fresh recovery link and try again.",
        );
        setRemoving(false);
        return;
      }
      // The factor is gone. Best-effort refresh so the session's AAL claims
      // catch up — but removing a verified factor may already have invalidated
      // this session, so a failure here is expected and must NOT surface as a
      // removal error. Navigate regardless.
      try {
        await getSupabaseBrowser()?.auth.refreshSession();
      } catch {
        // Session already invalidated by the removal — that's fine.
      }
      window.location.assign("/app");
    } catch {
      setRemoveError("Couldn't remove it. Try again.");
      setRemoving(false);
    }
  }

  if (mode === "lost") {
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Remove two-step verification?</p>
          <p className="text-xs text-muted-foreground">
            We&apos;ll remove the authenticator on your account so you can sign
            in with this recovery link. Set up two-step verification again from
            Settings once you&apos;re back in.
          </p>
        </div>
        {removeError && (
          <p
            role="alert"
            className="text-xs text-destructive"
          >
            {removeError}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            className="w-full"
            disabled={removing}
            onClick={() => void removeAuthenticator()}
          >
            {removing ? "Removing…" : "Remove and continue"}
          </Button>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            disabled={removing}
            onClick={() => {
              setMode("have");
              setRemoveError(null);
            }}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-4"
    >
      <div
        role="status"
        className="space-y-2 rounded-md border border-border/60 bg-card px-4 py-3"
      >
        <p className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4" />
          Two-step verification
        </p>
        <p className="text-xs text-muted-foreground">
          Open your authenticator app and enter the 6-digit code to finish
          signing in.
        </p>
      </div>

      <TotpCodeInput
        id="recover-totp"
        value={code}
        onValueChange={setCode}
        disabled={busy}
        autoFocus
      />

      {error && (
        <p
          role="alert"
          className="text-xs text-destructive"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          className="w-full"
          disabled={busy || code.length !== 6}
        >
          {busy ? "Verifying…" : "Continue"}
        </Button>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          disabled={busy}
          onClick={() => setMode("lost")}
        >
          I&apos;ve lost my authenticator
        </button>
      </div>
    </form>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to app
          </Link>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight">
              Account recovery
            </h1>
            <p className="text-sm text-muted-foreground">
              Let&apos;s get you back into your account.
            </p>
          </div>
          {children}
        </div>
      </main>
      <Footer />
    </div>
  );
}
