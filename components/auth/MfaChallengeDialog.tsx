"use client";

import { PasteOtpButton } from "@/components/auth/PasteOtpButton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type MfaChallengeResolver,
  subscribeMfaChallenge,
} from "@/lib/auth/mfa-challenge-bus";
import { getVerifiedTotpFactorId } from "@/lib/auth/mfa-factors";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

/** Global MFA challenge dialog. Mounted ONCE per app session in
 *  [components/shell/AppShell.tsx](../shell/AppShell.tsx) and the
 *  landing page's layout — wherever a signed-in user might trigger
 *  a 403-with-`kind:"mfa-required"` and want to recover in-place
 *  without bouncing to `/login`.
 *
 *  Subscribes to [lib/auth/mfa-challenge-bus.ts](../../lib/auth/mfa-challenge-bus.ts).
 *  When any client-side fetch hits the AAL2 gate, the wrapper at
 *  [lib/auth/client-fetch.ts](../../lib/auth/client-fetch.ts) calls
 *  `requestMfaChallenge()`, this dialog opens, the user enters the
 *  6-digit code from their authenticator, we run
 *  `supabase.auth.mfa.challengeAndVerify`, resolve the bus promise,
 *  and the wrapper retries the original request. The user sees a
 *  brief modal, the failing action just works on retry.
 *
 *  Why the same TOTP flow as `/login`'s MFA stage: same Supabase
 *  factor, same verifier, same outcome. Once verified the session
 *  is at AAL2 and every subsequent fetch passes the gate without
 *  this dialog ever firing again (for the lifetime of the session). */
export function MfaChallengeDialog() {
  // The dialog is data-driven: it opens when the bus calls our
  // listener with a resolver. The resolver is stored in a ref so
  // the verify/cancel handlers can call resolve/reject without
  // re-rendering the listener subscription.
  const [open, setOpen] = useState(false);
  const resolverRef = useRef<MfaChallengeResolver | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeMfaChallenge(async (resolver) => {
      // Look up the user's verified TOTP factor BEFORE showing
      // the dialog. Without a factorId we can't run
      // challengeAndVerify, and showing a "Enter your code"
      // dialog that can't actually verify anything is hostile.
      // If the lookup fails (user signed out elsewhere, Supabase
      // outage) we reject the bus promise so the caller falls
      // back to its previous error path.
      const supabase = getSupabaseBrowser();
      if (!supabase) {
        resolver.reject("failed");
        return;
      }
      // getVerifiedTotpFactorId folds a thrown listFactors (signed out
      // elsewhere, Supabase outage) into `null`, so both "no factor" and
      // "lookup failed" reject the bus promise the same way.
      const verifiedId = await getVerifiedTotpFactorId(supabase);
      if (!verifiedId) {
        resolver.reject("failed");
        return;
      }
      resolverRef.current = resolver;
      setFactorId(verifiedId);
      setCode("");
      setError(null);
      setOpen(true);
    });
  }, []);

  async function verify() {
    if (!factorId || busy) return;
    const token = code.trim();
    if (!/^\d{6}$/.test(token)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const supabase = getSupabaseBrowser();
      if (!supabase) {
        setError("Supabase isn't configured.");
        return;
      }
      const { error: e } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: token,
      });
      if (e) throw e;
      // Success — resolve the bus promise so the fetch wrapper
      // can retry the original request. Then close the dialog.
      // Order matters: resolve first so a caller awaiting the
      // promise fires its retry as soon as possible; the dialog
      // close is purely visual cleanup.
      resolverRef.current?.resolve();
      resolverRef.current = null;
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to verify code.");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    resolverRef.current?.reject("cancelled");
    resolverRef.current = null;
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Treat any non-explicit close (overlay click, Escape) as
        // a cancel. The caller's rejection branch is what surfaces
        // the original error to the user, which is the right read
        // for "I dismissed the MFA prompt without finishing."
        if (!o) cancel();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Verify your second factor
          </DialogTitle>
          <DialogDescription>
            Enter the 6-digit code from your authenticator app to continue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Label
            htmlFor="mfa-challenge-code"
            className="text-xs font-medium text-muted-foreground"
          >
            Code
          </Label>
          <div className="relative">
            <Input
              id="mfa-challenge-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              onPaste={(e) => {
                // Paste defaults trip up here in two ways: the input's
                // `maxLength={6}` truncates a pasted string BEFORE our
                // regex strips whitespace, so "  123456  " (copied
                // with formatting) lands as "  1234" and then "1234".
                // Read the clipboard ourselves, sanitize to digits,
                // slice to the code length, and write it in — bypassing
                // both the browser truncation and the strip-after.
                e.preventDefault();
                const pasted = e.clipboardData
                  .getData("text")
                  .replace(/\D/g, "")
                  .slice(0, 6);
                if (pasted) setCode(pasted);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.length === 6) {
                  e.preventDefault();
                  void verify();
                }
              }}
              placeholder="123456"
              autoFocus
              className="pr-10 text-center font-mono text-lg tracking-[0.4em]"
            />
            <PasteOtpButton
              onPaste={setCode}
              disabled={busy}
            />
          </div>
          {error && (
            <p
              role="alert"
              className="text-xs text-destructive"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={cancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void verify()}
            disabled={busy || code.length !== 6}
            className="gap-1.5"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Verify
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
