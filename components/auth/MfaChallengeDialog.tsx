"use client";

import { TotpCodeInput } from "@/components/auth/TotpCodeInput";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type MfaChallengeResolver,
  subscribeMfaChallenge,
} from "@/lib/auth/mfa-challenge-bus";
import { getVerifiedTotpFactorId } from "@/lib/auth/mfa-factors";
import { useTotpChallenge } from "@/lib/auth/use-totp-challenge";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";

/** Global two-step-verification dialog. Mounted ONCE per app session in
 *  [components/shell/AppShell.tsx](../shell/AppShell.tsx) and the admin layout —
 *  wherever a signed-in user might trigger a 403-with-`kind:"mfa-required"` and
 *  want to recover in-place without bouncing to `/login`.
 *
 *  Subscribes to [lib/auth/mfa-challenge-bus.ts](../../lib/auth/mfa-challenge-bus.ts).
 *  When a client-side fetch hits the AAL2 gate, the wrapper at
 *  [lib/auth/client-fetch.ts](../../lib/auth/client-fetch.ts) calls
 *  `requestMfaChallenge()`, this dialog opens, the user enters the 6-digit code,
 *  we run `challengeAndVerify`, resolve the bus promise, and the wrapper retries
 *  the original request. The user sees a brief modal; the failing action just
 *  works on retry.
 *
 *  Shares the exact code input + verify logic with the /login challenge stage
 *  via `useTotpChallenge` + `TotpCodeInput`, so the two surfaces stay in lock-
 *  step (same auto-submit, same paste handling, same humanized errors). */
export function MfaChallengeDialog() {
  // The dialog is data-driven: it opens when the bus calls our listener with a
  // resolver. The resolver lives in a ref so verify/cancel can settle it
  // without re-subscribing.
  const [open, setOpen] = useState(false);
  const resolverRef = useRef<MfaChallengeResolver | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);

  useEffect(() => {
    return subscribeMfaChallenge(async (resolver) => {
      // Look up the verified factor BEFORE showing the dialog — a code field
      // that can't actually verify anything is hostile. getVerifiedTotpFactorId
      // folds a thrown listFactors (signed out elsewhere, outage) into null, so
      // both "no factor" and "lookup failed" reject the bus the same way.
      const supabase = getSupabaseBrowser();
      if (!supabase) {
        resolver.reject("failed");
        return;
      }
      const verifiedId = await getVerifiedTotpFactorId(supabase);
      if (!verifiedId) {
        resolver.reject("failed");
        return;
      }
      resolverRef.current = resolver;
      setFactorId(verifiedId);
      setOpen(true);
    });
  }, []);

  function cancel() {
    resolverRef.current?.reject("cancelled");
    resolverRef.current = null;
    setOpen(false);
  }

  function onVerified() {
    // Resolve first so a caller awaiting the promise fires its retry as soon as
    // possible; the dialog close is purely visual cleanup.
    resolverRef.current?.resolve();
    resolverRef.current = null;
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Any non-explicit close (overlay click, Escape) is a cancel — the
        // caller's rejection branch surfaces the original error, the right read
        // for "I dismissed the prompt without finishing."
        if (!o) cancel();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Two-step verification
          </DialogTitle>
          <DialogDescription>
            Enter the 6-digit code from your authenticator app to continue.
          </DialogDescription>
        </DialogHeader>
        {factorId && (
          <MfaChallengeBody
            factorId={factorId}
            onVerified={onVerified}
            onCancel={cancel}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The code-entry body. Split out so `useTotpChallenge` mounts/unmounts with
 *  the open dialog (fresh code each time it opens) and so it only runs once a
 *  `factorId` exists.
 *
 *  Lost-authenticator escape is a recovery LINK, not an in-dialog passkey
 *  sign-in: `signInWithPasskey` is a fresh sign-in that REPLACES the session and
 *  (with discoverable credentials) can resolve to a different account — fine on
 *  /login, but mid-action here it would silently change which user the gated
 *  request runs as, with no clean way to constrain it. The recovery link sends
 *  the user to the proper flow instead. */
function MfaChallengeBody({
  factorId,
  onVerified,
  onCancel,
}: {
  factorId: string;
  onVerified: () => void;
  onCancel: () => void;
}) {
  const { code, busy, error, setCode, submit } = useTotpChallenge({
    factorId,
    onVerified,
  });

  return (
    <>
      <div className="space-y-3 py-2">
        <TotpCodeInput
          id="mfa-challenge-code"
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
        <Link
          href="/login/recovery"
          aria-disabled={busy}
          onClick={(e) => {
            // Don't navigate away (cancelling the bus) while a verify is in
            // flight — it could cancel a challenge that's about to succeed.
            if (busy) {
              e.preventDefault();
              return;
            }
            onCancel();
          }}
          className={
            busy
              ? "pointer-events-none block text-xs text-muted-foreground/50 underline underline-offset-2"
              : "block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          }
        >
          Lost your authenticator?
        </Link>
      </div>

      <DialogFooter className="gap-2 sm:gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void submit()}
          disabled={busy || code.length !== 6}
          className="gap-1.5"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Verify
        </Button>
      </DialogFooter>
    </>
  );
}
