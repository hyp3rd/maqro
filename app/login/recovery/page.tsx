"use client";

import {
  TurnstileWidget,
  useTurnstile,
} from "@/components/auth/TurnstileWidget";
import { Footer } from "@/components/shell/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isLikelyEmail } from "@/lib/account/backup-email";
import { useState } from "react";
import { ArrowLeft, LifeBuoy } from "lucide-react";
import Link from "next/link";

/** Lost-email recovery entry point.
 *
 *  The user submits BOTH the primary email AND the backup email
 *  they previously verified in Settings. The server checks the
 *  pair against `profiles` and, on match, sends a one-shot magic
 *  sign-in link to the backup address. The response is
 *  intentionally 202 with the same body whether the pair matched
 *  or not — so an attacker probing for "does this user exist"
 *  learns nothing here.
 *
 *  Why require both addresses (not just the primary): raising the
 *  bar for a credential-stuffing bot that scrapes a primary-email
 *  list. They'd need to know the backup too, which isn't exposed
 *  anywhere in the app or in OG/SEO metadata. */
export default function RecoveryPage() {
  const [primaryEmail, setPrimaryEmail] = useState("");
  const [backupEmail, setBackupEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnstile = useTurnstile();

  async function submit() {
    setError(null);
    const p = primaryEmail.trim().toLowerCase();
    const b = backupEmail.trim().toLowerCase();
    if (!isLikelyEmail(p)) {
      setError("Enter a valid primary email address.");
      return;
    }
    if (!isLikelyEmail(b)) {
      setError("Enter a valid backup email address.");
      return;
    }
    if (p === b) {
      setError("Primary and backup must be different addresses.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryEmail: p,
          backupEmail: b,
          turnstileToken: turnstile.token ?? undefined,
        }),
      });
      // A 403 is the bot challenge (Turnstile / BotID) failing — surface it and
      // re-challenge. It's orthogonal to account existence, so it leaks nothing.
      if (res.status === 403) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Couldn't verify you're human. Try again.");
        return;
      }
      // Otherwise we never distinguish hit vs miss client-side — always show the
      // same confirmation, so an observer of the network tab can't infer
      // existence.
      setSubmitted(true);
    } catch {
      // A network failure is fine to surface — it's about the
      // request itself, not about whether the account exists.
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
      // The single-use token is spent on a delivered request; mint a fresh one
      // for any retry. Harmless on the success path (the form is now read-only).
      turnstile.reset();
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to sign in
          </Link>

          <div className="space-y-1">
            <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <LifeBuoy className="h-4 w-4 text-muted-foreground" />
              Recover access
            </h1>
            <p className="text-sm text-muted-foreground">
              Lost your authenticator or your email? Send a one-shot sign-in
              link to the backup email you verified in Settings — from there you
              can finish signing in or reset two-step verification.
            </p>
          </div>

          {submitted ? (
            <div
              role="status"
              className="space-y-3 rounded-md border border-border/60 bg-card px-4 py-3 text-xs"
            >
              <p className="text-sm font-medium">Check your backup inbox.</p>
              <p className="text-muted-foreground">
                If both addresses match a Maqro account with a verified backup,
                a sign-in link has been sent to the backup address. It works
                once and expires in an hour.
              </p>
              <p className="text-muted-foreground">
                Didn&apos;t set up a backup before losing access? Contact
                support at{" "}
                <a
                  href="mailto:support@maqro.app"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  support@maqro.app
                </a>
                .
              </p>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label
                  htmlFor="recovery-primary"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Primary email
                </Label>
                <Input
                  id="recovery-primary"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={primaryEmail}
                  onChange={(e) => setPrimaryEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={busy}
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="recovery-backup"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Backup email
                </Label>
                <Input
                  id="recovery-backup"
                  type="email"
                  required
                  autoComplete="email"
                  value={backupEmail}
                  onChange={(e) => setBackupEmail(e.target.value)}
                  placeholder="you-elsewhere@example.com"
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
              <TurnstileWidget {...turnstile.widgetProps} />
              <Button
                type="submit"
                className="w-full"
                disabled={busy || !turnstile.ready}
              >
                {busy ? "Sending…" : "Send recovery link"}
              </Button>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                The link is delivered to the backup address (not the primary).
                If the addresses don&apos;t match a verified account, no email
                is sent and no error is shown — recovery is intentionally silent
                on misses.
              </p>
            </form>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
