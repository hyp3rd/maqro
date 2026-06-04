"use client";

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
import { MIN_PASSPHRASE_LENGTH } from "@/lib/export-crypto";
import { useState } from "react";
import { ShieldAlert } from "lucide-react";

type Props = {
  open: boolean;
  /** `encrypt` asks twice (passphrase + confirm) and warns about loss;
   *  `decrypt` asks once and surfaces a wrong-passphrase error to retry. */
  mode: "encrypt" | "decrypt";
  /** Error from the caller's last attempt (e.g. wrong passphrase on decrypt). */
  error?: string | null;
  /** True while the caller is encrypting/decrypting — disables the controls. */
  busy?: boolean;
  onSubmit: (passphrase: string) => void;
  onCancel: () => void;
};

/** Collects an export passphrase. Zero-knowledge: the passphrase never leaves
 *  this dialog except to the in-memory crypto call the caller runs — it's
 *  never stored or sent anywhere. */
export function PassphraseDialog({
  open,
  mode,
  error,
  busy,
  onSubmit,
  onCancel,
}: Props) {
  // Fresh empty state on every open: the parent remounts this component with a
  // changing `key` each time it prompts, so a passphrase never lingers in
  // component state between uses (no reset-in-effect needed).
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const isEncrypt = mode === "encrypt";

  function submit() {
    setLocalError(null);
    if (pass.length < MIN_PASSPHRASE_LENGTH) {
      setLocalError(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`);
      return;
    }
    if (isEncrypt && pass !== confirm) {
      setLocalError("Passphrases don't match.");
      return;
    }
    onSubmit(pass);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEncrypt ? "Encrypt this backup" : "Unlock this backup"}
          </DialogTitle>
          <DialogDescription>
            {isEncrypt
              ? "Your backup is encrypted on this device before it's uploaded — only this passphrase can unlock it."
              : "Enter the passphrase you set when this backup was saved."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label
              htmlFor="passphrase"
              className="text-xs font-medium text-muted-foreground"
            >
              Passphrase
            </Label>
            <Input
              id="passphrase"
              type="password"
              autoFocus
              autoComplete={isEncrypt ? "new-password" : "current-password"}
              value={pass}
              disabled={busy}
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isEncrypt) submit();
              }}
            />
          </div>

          {isEncrypt && (
            <div className="space-y-1.5">
              <Label
                htmlFor="passphrase-confirm"
                className="text-xs font-medium text-muted-foreground"
              >
                Confirm passphrase
              </Label>
              <Input
                id="passphrase-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                disabled={busy}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
            </div>
          )}

          {isEncrypt && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                If you lose this passphrase, the backup{" "}
                <span className="font-semibold">cannot be recovered</span> — not
                even by us. Store it somewhere safe.
              </span>
            </div>
          )}

          {(localError || error) && (
            <p
              role="alert"
              className="text-xs text-destructive"
            >
              {localError ?? error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={busy}
          >
            {busy
              ? isEncrypt
                ? "Encrypting…"
                : "Unlocking…"
              : isEncrypt
                ? "Encrypt & upload"
                : "Unlock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PassphraseDialog;
