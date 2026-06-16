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
import { useWebAuthnSupported } from "@/hooks/use-webauthn-supported";
import {
  type MfaChallengeResolver,
  subscribeMfaChallenge,
} from "@/lib/auth/mfa-challenge-bus";
import { getVerifiedTotpFactorId } from "@/lib/auth/mfa-factors";
import { signOutAndClearLocal } from "@/lib/auth/sign-out";
import { usePasskeyChallenge } from "@/lib/auth/use-passkey-challenge";
import { useTotpChallenge } from "@/lib/auth/use-totp-challenge";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useEffect, useRef, useState } from "react";
import { Fingerprint, Loader2, ShieldCheck } from "lucide-react";
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
  // Whether the current user ALSO has a passkey — drives the "use a passkey
  // instead" button. The dialog still requires a verified TOTP factor to open
  // (that's who the gate fires for); the passkey is an extra one-tap option.
  const [hasPasskey, setHasPasskey] = useState(false);

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
      // Best-effort: does this user have a passkey to offer as an alternative?
      // Any failure (outage, feature off) just hides the button — TOTP works.
      let passkey = false;
      if (typeof window !== "undefined" && "PublicKeyCredential" in window) {
        const res = await supabase.auth.passkey.list().catch(() => null);
        passkey = Array.isArray(res?.data) && res.data.length > 0;
      }
      resolverRef.current = resolver;
      setFactorId(verifiedId);
      setHasPasskey(passkey);
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

  async function onBail() {
    // A passkey resolved to a DIFFERENT account: `signInWithPasskey` already
    // replaced the session with the wrong identity. Never let the gated action
    // retry as that user — REJECT the bus (the caller returns its original 403,
    // no replay), discard the wrong session, and bounce to a clean /login.
    resolverRef.current?.reject("failed");
    resolverRef.current = null;
    setOpen(false);
    const supabase = getSupabaseBrowser();
    if (supabase) await signOutAndClearLocal(supabase);
    window.location.assign("/login");
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
            hasPasskey={hasPasskey}
            onVerified={onVerified}
            onBail={onBail}
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
 *  Passkey alternative: a user with a passkey can step up by tapping "use a
 *  passkey instead" rather than typing the code. The risk that originally
 *  deferred this — `signInWithPasskey` REPLACES the session and (discoverable)
 *  could resolve to a DIFFERENT account, silently changing which user the gated
 *  request runs as — is handled in `usePasskeyChallenge`: it compares the user
 *  id before/after and, on a mismatch, takes the `onBail` path (reject the bus
 *  so the action never runs, then sign out to a clean /login) instead of
 *  resolving. The "Lost your authenticator?" recovery link stays for users with
 *  no passkey. */
function MfaChallengeBody({
  factorId,
  hasPasskey,
  onVerified,
  onBail,
  onCancel,
}: {
  factorId: string;
  hasPasskey: boolean;
  onVerified: () => void;
  onBail: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const { code, busy, error, setCode, setError, submit } = useTotpChallenge({
    factorId,
    onVerified,
  });
  const passkeySupported = useWebAuthnSupported();
  const passkey = usePasskeyChallenge({ onVerified, onBail });

  // One error slot, like the login stage: whichever path is active owns the
  // message and clears the other's so a stale line never lingers.
  const anyBusy = busy || passkey.busy;
  const displayError = passkey.error ?? error;

  function onCodeChange(next: string) {
    setCode(next); // also clears the TOTP error
    if (passkey.error) passkey.setError(null);
  }

  async function handlePasskey() {
    setError(null); // drop any stale TOTP error before the passkey takes over
    passkey.setError(null);
    await passkey.run();
  }

  return (
    <>
      <div className="space-y-3 py-2">
        <TotpCodeInput
          id="mfa-challenge-code"
          value={code}
          onValueChange={onCodeChange}
          disabled={anyBusy}
          autoFocus
        />
        {displayError && (
          <p
            role="alert"
            className="text-xs text-destructive"
          >
            {displayError}
          </p>
        )}
        {passkeySupported && hasPasskey && (
          <Button
            type="button"
            variant="outline"
            onClick={() => void handlePasskey()}
            disabled={anyBusy}
            className="w-full gap-2"
          >
            <Fingerprint className="h-4 w-4" />
            {passkey.busy ? "Verifying…" : "Use a passkey instead"}
          </Button>
        )}
        <Link
          href="/login/recovery"
          aria-disabled={anyBusy}
          onClick={(e) => {
            // Don't navigate away (cancelling the bus) while a verify is in
            // flight — it could cancel a challenge that's about to succeed.
            if (anyBusy) {
              e.preventDefault();
              return;
            }
            onCancel();
          }}
          className={
            anyBusy
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
          disabled={anyBusy}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void submit()}
          disabled={anyBusy || code.length !== 6}
          className="gap-1.5"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Verify
        </Button>
      </DialogFooter>
    </>
  );
}
