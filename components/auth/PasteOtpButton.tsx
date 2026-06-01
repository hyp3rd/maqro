"use client";

import { ClipboardCheck } from "lucide-react";
import { toast } from "sonner";

/** Small icon button that reads the system clipboard, extracts the
 *  first run of digits, and hands them to the parent's setter via
 *  `onPaste`. Sits inside a `relative` container around an OTP/TOTP
 *  `<Input>`; pair with `pr-10` on the input so the absolutely-
 *  positioned button doesn't overlap typed text.
 *
 *  Why a visible button on top of the existing `onPaste` keydown
 *  handler: on mobile, summoning the system paste menu over a
 *  numeric input is fiddly (long-press near the caret, hope the
 *  hit-test resolves the input not the surrounding label). A
 *  dedicated affordance turns the gesture into "tap, tap" instead
 *  of "long-press, drag, tap paste, hope the value lands."
 *
 *  Clipboard access: `navigator.clipboard.readText()` requires a
 *  user activation (we have it — they clicked the button) and a
 *  secure context (https / localhost). If either is missing or the
 *  user denies the permission prompt, we toast a hint pointing at
 *  the keyboard shortcut as a fallback. */
export function PasteOtpButton({
  onPaste,
  length = 6,
  disabled = false,
}: {
  onPaste: (digits: string) => void;
  length?: number;
  disabled?: boolean;
}) {
  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      const digits = text.replace(/\D/g, "").slice(0, length);
      if (digits.length === 0) {
        toast.error("Clipboard doesn't contain a numeric code.");
        return;
      }
      onPaste(digits);
    } catch {
      toast.error("Couldn't read the clipboard. Paste with Ctrl/Cmd + V.");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void paste()}
      disabled={disabled}
      aria-label="Paste code from clipboard"
      title="Paste code"
      className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      <ClipboardCheck className="h-4 w-4" />
    </button>
  );
}
