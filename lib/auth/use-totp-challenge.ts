"use client";

import { humanizeMfaError } from "@/lib/auth/mfa-errors";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useEffect, useRef, useState } from "react";

/** Shared logic for the two-step-verification code entry used by BOTH the
 *  /login challenge stage and the in-app step-up dialog — the part that used to
 *  diverge between the two surfaces.
 *
 *  Owns the code value, runs `challengeAndVerify`, humanizes the error, and
 *  auto-submits the moment a 6th digit lands (authenticator apps copy a fully-
 *  formed code, so the manual button is just an extra tap; it stays as the
 *  fallback). `onVerified` runs once the session reaches AAL2 — the caller
 *  navigates (login) or resolves the challenge bus (dialog). */
export function useTotpChallenge({
  factorId,
  onVerified,
}: {
  factorId: string;
  onVerified: () => void | Promise<void>;
}) {
  const [code, setCodeRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setCode(next: string) {
    setCodeRaw(next);
    setError(null);
  }

  async function submit(explicit?: string) {
    if (busy) return;
    const token = (explicit ?? code).trim();
    if (!/^\d{6}$/.test(token)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setError("This app isn't set up for sign-in yet.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { error: e } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: token,
      });
      if (e) throw e;
      // AAL2 reached. The caller takes over (navigate / resolve); on those
      // paths this surface unmounts, so we deliberately leave `busy` true to
      // avoid a flash of the re-enabled button before it disappears.
      await onVerified();
    } catch (e) {
      setError(humanizeMfaError(e));
      setBusy(false);
    }
  }

  // Auto-submit on the 6th digit. A ref holds the latest `submit` closure —
  // updated in an effect, never during render — so the trigger effect's deps
  // stay [code, busy] while still calling the current factorId/onVerified.
  // `autoSubmittedRef` records which exact code already fired, so a wrong-code →
  // fix-one-digit retry doesn't re-spam challengeAndVerify with the same value.
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });
  const autoSubmittedRef = useRef<string | null>(null);
  useEffect(() => {
    if (busy) return;
    if (code.length !== 6) {
      autoSubmittedRef.current = null;
      return;
    }
    if (autoSubmittedRef.current === code) return;
    autoSubmittedRef.current = code;
    void submitRef.current(code);
  }, [code, busy]);

  // `setError` is exposed so a sibling control (e.g. the login passkey escape)
  // can clear a stale TOTP error when it takes over.
  return { code, setCode, busy, error, setError, submit };
}
