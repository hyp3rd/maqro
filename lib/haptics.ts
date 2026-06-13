"use client";

/** Tiny haptic-feedback helper for the PWA. Wraps the Vibration API with
 *  intent-named patterns so call sites read clearly (`haptic("success")`
 *  rather than a magic `navigator.vibrate([20])`).
 *
 *  Guards:
 *   - SSR / no Vibration API → no-op (most desktop browsers + iOS Safari in a
 *     browser tab return false; iOS only vibrates for installed PWAs, and even
 *     then support is partial — so this is a progressive enhancement, never a
 *     dependency).
 *   - `prefers-reduced-motion: reduce` → no-op. Vibration is motion; a user who
 *     opted out of motion shouldn't be buzzed.
 *
 *  Never throws — a blocked or unsupported call is silently ignored. */
export type HapticIntent =
  | "tap" // a light confirm — a button/FAB press
  | "success" // a thing landed — food logged, item saved
  | "warning" // a destructive/edge action — clear meal, cap hit
  | "select"; // a small selection tick — toggle, segment change

const PATTERNS: Record<HapticIntent, number | number[]> = {
  tap: 10,
  success: [18],
  warning: [24, 40, 24],
  select: 8,
};

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Fire a haptic for the given intent. Best-effort; safe to call anywhere. */
export function haptic(intent: HapticIntent = "tap"): void {
  if (typeof navigator === "undefined" || typeof window === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  if (reducedMotion()) return;
  try {
    navigator.vibrate(PATTERNS[intent]);
  } catch {
    // A blocked/odd implementation — ignore.
  }
}
