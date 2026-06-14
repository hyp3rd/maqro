"use client";

import { TotpCodeInput } from "@/components/auth/TotpCodeInput";
import { Button } from "@/components/ui/button";
import { useTotpChallenge } from "@/lib/auth/use-totp-challenge";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";

/** The TOTP challenge stage of /login: shown after the email OTP step when the
 *  account has two-step verification on (or on a `?mfa=required` resume). Shares
 *  the verify logic + code input with the in-app step-up dialog via
 *  `useTotpChallenge` / `TotpCodeInput`; what stays here is the login-specific
 *  chrome — the "trust this device" opt-in and the bail-out link. */
export function LoginMfaStage({
  factorId,
  onVerified,
  onUseDifferentEmail,
}: {
  factorId: string;
  /** Runs once the session reaches AAL2; receives whether to trust the device. */
  onVerified: (opts: { trustDevice: boolean }) => void;
  onUseDifferentEmail: () => void;
}) {
  const [trustDevice, setTrustDevice] = useState(false);
  const { code, setCode, busy, error, submit } = useTotpChallenge({
    factorId,
    onVerified: () => onVerified({ trustDevice }),
  });

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

      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border/60 bg-card px-3 py-2.5 text-xs">
        <input
          type="checkbox"
          checked={trustDevice}
          onChange={(e) => setTrustDevice(e.target.checked)}
          disabled={busy}
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
          disabled={busy || code.length !== 6}
        >
          {busy ? "Verifying…" : "Sign in"}
        </Button>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          disabled={busy}
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
