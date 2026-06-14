"use client";

import { PasteOtpButton } from "@/components/auth/PasteOtpButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The 6-digit authenticator-code field shared by the /login two-step stage and
 *  the in-app challenge dialog. Numeric input + a clipboard-paste affordance,
 *  with paste sanitization that survives leading/trailing whitespace: the
 *  input's `maxLength` would otherwise truncate "  123456  " (copied with
 *  formatting) to "  1234" before our digit-strip runs, so we intercept the
 *  paste, strip non-digits, and slice ourselves. */
export function TotpCodeInput({
  id,
  value,
  onValueChange,
  disabled = false,
  autoFocus = false,
}: {
  id: string;
  value: string;
  onValueChange: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const sanitize = (raw: string) => raw.replace(/\D/g, "").slice(0, 6);
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={id}
        className="text-xs font-medium text-muted-foreground"
      >
        Code
      </Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={6}
          value={value}
          autoFocus={autoFocus}
          disabled={disabled}
          onChange={(e) => onValueChange(sanitize(e.target.value))}
          onPaste={(e) => {
            e.preventDefault();
            const pasted = sanitize(e.clipboardData.getData("text"));
            if (pasted) onValueChange(pasted);
          }}
          placeholder="123456"
          className="pr-10 text-center font-mono text-lg tabular-nums tracking-[0.3em]"
        />
        <PasteOtpButton
          onPaste={onValueChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
