"use client";

import { TotpCodeInput } from "@/components/auth/TotpCodeInput";
import { Button } from "@/components/ui/button";
import { useTotpChallenge } from "@/lib/auth/use-totp-challenge";
import { useState } from "react";
import { Fingerprint, ShieldCheck } from "lucide-react";
import Link from "next/link";

/** The TOTP challenge stage of /login: shown after the email OTP step when the
 *  account has two-step verification on (or on a `?mfa=required` resume). Shares
 *  the verify logic + code input with the in-app step-up dialog via
 *  `useTotpChallenge` / `TotpCodeInput`; what stays here is the login-specific
 *  chrome — the "trust this device" opt-in, the passkey escape, and the
 *  recovery links. The passkey button is the key lost-authenticator escape on
 *  the `?mfa=required` resume path, which never shows the request stage. */
export function LoginMfaStage({
  factorId,
  onVerified,
  onUseDifferentEmail,
  passkeySupported = false,
  onUsePasskey,
}: {
  factorId: string;
  /** Runs once the session reaches AAL2; receives whether to trust the device. */
  onVerified: (opts: { trustDevice: boolean }) => void;
  onUseDifferentEmail: () => void;
  passkeySupported?: boolean;
  /** Runs the passkey ceremony; navigates on success, returns a humanized error
   *  string on failure (null when it navigated away). A passkey login satisfies
   *  our MFA gate (recognized from the session's auth methods), so it works as
   *  an alternative to the authenticator code. */
  onUsePasskey?: () => Promise<string | null>;
}) {
  const [trustDevice, setTrustDevice] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const { code, setCode, busy, error, setError, submit } = useTotpChallenge({
    factorId,
    onVerified: () => onVerified({ trustDevice }),
  });

  // One error at a time: the TOTP path and the passkey path each clear the
  // other's error when they take over, and a single slot renders whichever is
  // set — so a failed passkey attempt can't leave a stale red line below a
  // subsequent code entry, and the two never double-announce.
  const displayError = passkeyError ?? error;

  function onCodeChange(next: string) {
    setCode(next); // also clears the hook's TOTP error
    if (passkeyError) setPasskeyError(null);
  }

  async function handlePasskey() {
    if (!onUsePasskey) return;
    setError(null); // drop any stale TOTP error
    setPasskeyError(null);
    setPasskeyBusy(true);
    const err = await onUsePasskey();
    if (err) {
      setPasskeyError(err);
      setPasskeyBusy(false);
    }
    // On success onUsePasskey navigates away; leave passkeyBusy true so the
    // controls stay disabled until the page unloads.
  }

  const anyBusy = busy || passkeyBusy;

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
          Open your authenticator app and enter the 6-digit code for this
          account.
        </p>
      </div>

      <TotpCodeInput
        id="mfa-totp"
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

      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border/60 bg-card px-3 py-2.5 text-xs">
        <input
          type="checkbox"
          checked={trustDevice}
          onChange={(e) => setTrustDevice(e.target.checked)}
          disabled={anyBusy}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-foreground"
        />
        <span className="space-y-0.5">
          <span className="block font-medium">
            Trust this device for 7 days
          </span>
          <span className="block text-muted-foreground">
            Skip the verification step on this browser until then. You can
            revoke from Settings.
          </span>
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          className="w-full"
          disabled={anyBusy || code.length !== 6}
        >
          {busy ? "Verifying…" : "Sign in"}
        </Button>

        {passkeySupported && onUsePasskey && (
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            disabled={anyBusy}
            onClick={() => void handlePasskey()}
          >
            <Fingerprint className="h-4 w-4" />
            {passkeyBusy ? "Verifying…" : "Use a passkey instead"}
          </Button>
        )}

        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          disabled={anyBusy}
          onClick={onUseDifferentEmail}
        >
          Use a different email
        </button>
        <Link
          href="/login/recovery"
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Lost your authenticator?
        </Link>
      </div>
    </form>
  );
}
