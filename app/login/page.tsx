"use client";

import { PasteOtpButton } from "@/components/auth/PasteOtpButton";
import { AppleLogo } from "@/components/icons/AppleLogo";
import { GoogleLogo } from "@/components/icons/GoogleLogo";
import { Footer } from "@/components/shell/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWebAuthnSupported } from "@/hooks/use-webauthn-supported";
import { isLikelyEmail } from "@/lib/account/backup-email";
import { getVerifiedTotpFactorId } from "@/lib/auth/mfa-factors";
import { humanizePasskeyError } from "@/lib/auth/passkey-errors";
import { getOrCreateDeviceId } from "@/lib/devices/identity";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft, ClipboardPaste, Fingerprint, Mail } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type Stage =
  | { kind: "request" }
  | { kind: "verify"; email: string }
  // MFA challenge - only entered after a successful OTP verify
  // when the user has a verified TOTP factor enrolled. `factorId`
  // is the row from `mfa.listFactors()` that we'll challenge.
  | { kind: "mfa"; factorId: string };

/** Only allow same-origin paths so a hostile `?next=https://evil.com`
 *  can't redirect away from the app post-login. Empty / missing /
 *  not-starting-with-`/` all fall back to home. */
function safeNext(raw: string | null): string {
  // Post-login destination defaults to the app, not the landing
  // page at `/`. A user who just signed in wants the product.
  if (!raw) return "/app";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/app";
  return raw;
}

/** Wrapper. `useSearchParams` triggers a static-prerender bailout in
 *  Next.js 15+, so the part of the page that reads it lives inside a
 *  Suspense boundary. The fallback matches the layout shell so there's
 *  no visible flicker - only the form's "submit" target depends on
 *  the param. */
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginShell configured={isSupabaseConfigured()} />}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginShell({ configured }: { configured: boolean }) {
  // Used as the Suspense fallback - same chrome as the real form so
  // there's no layout shift between fallback and ready states.
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to app
          </Link>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
            <p className="text-sm text-muted-foreground">
              We&apos;ll email you a one-time code. No passwords.
            </p>
          </div>
          {!configured && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              Supabase isn&apos;t configured for this build. See README →
              Supabase setup to add the env vars.
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  // When the proxy detects an AAL1 session with a verified TOTP
  // factor on a protected page, it redirects here with
  // `?mfa=required`. We use that as a signal to jump straight to
  // the TOTP challenge stage on mount — no need to send another
  // OTP, the session is already at AAL1.
  const mfaRequired = searchParams.get("mfa") === "required";
  const [stage, setStage] = useState<Stage>({ kind: "request" });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [appleBusy, setAppleBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configured = isSupabaseConfigured();
  const webauthnSupported = useWebAuthnSupported();

  // Resume-MFA path. When the page loads with `?mfa=required`,
  // the user already has an AAL1 session with TOTP enrolled (the
  // proxy verified both before redirecting here). We pull the
  // verified TOTP factor id and drop into the MFA stage directly,
  // skipping the email + OTP steps entirely. Defensive against
  // races: if the session disappeared between proxy-check and
  // page-mount (signed out from another tab), we fall back to the
  // ordinary request stage instead of getting stuck.
  useEffect(() => {
    if (!mfaRequired) return;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    let cancelled = false;
    void (async () => {
      // getVerifiedTotpFactorId swallows a thrown listFactors (the user
      // signed out elsewhere, Supabase outage) into `null`, so a missing
      // factor just leaves the page on its default request stage.
      const factorId = await getVerifiedTotpFactorId(supabase);
      if (cancelled) return;
      if (factorId) {
        setStage({ kind: "mfa", factorId });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mfaRequired]);

  async function sendCode() {
    setError(null);
    const trimmed = email.trim().toLowerCase();
    if (!isLikelyEmail(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setError("Supabase isn't configured. See README → Supabase setup.");
      return;
    }
    setBusy(true);
    setEmailBusy(true);
    try {
      // Pre-flight abuse gate. Hits a server route that does the
      // disposable-domain block + per-IP/per-email throttle BEFORE
      // we let Supabase send an OTP. Bypassable by anyone who calls
      // Supabase directly, but catches the casual bot traffic that
      // comes through this UI.
      const gateRes = await fetch("/api/auth/signup-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!gateRes.ok) {
        const data = (await gateRes.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? "Couldn't start sign-in. Try again.");
        return;
      }
      // Same Supabase email contains both a magic link and a numeric OTP
      // (length is configurable in Supabase: Auth → Providers → Email →
      // OTP length; commonly 6 or 8). The code-paste path is cross-device-
      // safe (no PKCE verifier on this browser required) and avoids the
      // cookie-propagation failure modes of the link click.
      const { error: e } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          shouldCreateUser: true,
          // Click-the-link fallback: Supabase's verify endpoint will
          // redirect here with `?code=…` after PKCE verification, and
          // /auth/callback exchanges the code for a session. The
          // `next` param round-trips so visitors who arrived from
          // `/r/<slug>?next=...` land back on the recipe page after
          // signing in. Only works when the user clicks the link on
          // the same browser they requested it from (PKCE verifier
          // lives in cookies on this origin). The numeric-code path
          // below is the cross-device path.
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (e) throw e;
      setCode("");
      setStage({ kind: "verify", email: trimmed });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send code.");
    } finally {
      setBusy(false);
      setEmailBusy(false);
    }
  }

  /** OAuth sign-in via an external provider (Google / Apple).
   *  Supabase handles the entire flow: the redirect dance, the code
   *  exchange (in `/auth/callback`), and session-cookie planting. We
   *  pass `redirectTo` with the `next` param so the post-sign-in
   *  landing respects deep links the same way the email flow does.
   *
   *  Shared across both providers because the only differences are
   *  the `provider` string and which button-caption flag to flip —
   *  the SDK call, redirect target, and error handling are identical.
   *  `busy` disables the email + paste controls (no parallel flows);
   *  `setProviderBusy` flips just the tapped button's caption to
   *  "Authenticating…". */
  async function signInWithOAuthProvider(
    provider: "google" | "apple",
    setProviderBusy: (v: boolean) => void,
    label: string,
  ) {
    setError(null);
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setError("Supabase isn't configured. See README → Supabase setup.");
      return;
    }
    setBusy(true);
    setProviderBusy(true);
    try {
      const { error: e } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (e) throw e;
      // Note: signInWithOAuth resolves only with a `url` (which the
      // SDK auto-redirects to). The line below typically doesn't
      // execute — we're already on the provider's consent screen.
    } catch (e) {
      setError(
        e instanceof Error ? e.message : `Couldn't open ${label} sign-in.`,
      );
      setBusy(false);
      setProviderBusy(false);
    }
  }

  /** Passkey sign-in. Supabase's `signInWithPasskey` drives the
   *  WebAuthn ceremony itself (`navigator.credentials.get`) using
   *  discoverable credentials — no email needed up-front, the
   *  authenticator resolves the user. On success the browser SDK
   *  has already planted the session; passkeys are AAL2 by default,
   *  so the MFA promotion dance the email-OTP path runs is
   *  unnecessary here.
   *
   *  Error surface: the SDK throws a `WebAuthnError` for ceremony
   *  failures (user cancelled, no credential registered, challenge
   *  expired). We map a few common cases to friendlier copy; anything
   *  else falls through to the raw message rather than silently
   *  swallowing it. */
  async function signInWithPasskey() {
    setError(null);
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setError("Supabase isn't configured. See README → Supabase setup.");
      return;
    }
    setBusy(true);
    setPasskeyBusy(true);
    try {
      const { error: e } = await supabase.auth.signInWithPasskey();
      if (e) throw e;
      // Hard navigation so the proxy sees the new session on the very
      // next request. Same pattern as the email-code success path.
      window.location.assign(next);
    } catch (e) {
      setError(humanizePasskeyError(e));
      setBusy(false);
      setPasskeyBusy(false);
    }
  }

  /** Read the clipboard, extract digits, fill the field. Useful when
   *  the user copied the code out of the email - saves the long-press
   *  + Paste menu on mobile and a paste shortcut on desktop. Falls
   *  back to a readable error if the browser denies clipboard access
   *  (Firefox is restrictive without HTTPS + a user gesture). */
  async function pasteCode() {
    setError(null);
    try {
      const text = await navigator.clipboard.readText();
      const digits = text.replace(/\D/g, "").slice(0, 10);
      if (digits.length < 4) {
        setError(
          "Clipboard doesn't contain a recognizable code. Paste manually.",
        );
        return;
      }
      setCode(digits);
    } catch {
      setError(
        "Couldn't read the clipboard. Long-press the field and paste manually.",
      );
    }
  }

  async function verifyCode() {
    if (stage.kind !== "verify") return;
    setError(null);
    const token = code.trim();
    // OTP length is configurable in Supabase (default 6, commonly 6 or 8).
    // Accept any digits-only string in a sensible range; let Supabase be
    // the authority on whether the value matches.
    if (!/^\d{4,10}$/.test(token)) {
      setError("Enter the numeric code from your email.");
      return;
    }
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setError("Supabase isn't configured.");
      return;
    }
    setBusy(true);
    try {
      const { error: e } = await supabase.auth.verifyOtp({
        email: stage.email,
        token,
        type: "email",
      });
      if (e) throw e;

      // OTP succeeded → session exists at AAL1. If the user
      // enrolled a TOTP factor we need to promote the session to
      // AAL2 before letting them past /login. The check is cheap
      // (a single GET) and falls back to "no MFA" silently on any
      // error so a Supabase outage on this endpoint doesn't lock
      // a non-MFA user out.
      try {
        const verifiedTotpId = await getVerifiedTotpFactorId(supabase);
        if (verifiedTotpId) {
          const aalResp =
            await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
          if (
            aalResp.data?.currentLevel === "aal1" &&
            aalResp.data?.nextLevel === "aal2"
          ) {
            // Trusted-device bypass. If the user previously
            // checked "Trust this device for 7 days" on this
            // browser and that window hasn't expired, skip the
            // MFA challenge and proceed with the AAL1 session.
            // Default-deny on any error (the server returns
            // `trusted: false` for outages too) - we never want
            // a failed trust check to AUTO-skip MFA.
            const deviceId = getOrCreateDeviceId();
            if (deviceId) {
              try {
                const checkRes = await fetch(
                  "/api/auth/mfa/trusted-devices/check",
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ deviceId }),
                  },
                );
                if (checkRes.ok) {
                  const checkBody = (await checkRes.json()) as {
                    trusted?: boolean;
                  };
                  if (checkBody.trusted) {
                    window.location.assign(next);
                    return;
                  }
                }
              } catch {
                // Network error on the trust check - fall through
                // to the MFA stage. Better to ask for the second
                // factor than to silently skip it.
              }
            }
            setStage({ kind: "mfa", factorId: verifiedTotpId });
            setCode("");
            setBusy(false);
            return;
          }
        }
      } catch {
        // Best-effort MFA detection. Fall through to navigation
        // rather than blocking a sign-in on an MFA-API error.
      }

      // Hard navigation so the proxy sees the new session cookie on the
      // very next request and rehydrates everywhere. Honours `?next=`
      // so visitors arriving from a shared resource (e.g. `/r/<slug>`)
      // land back on it after sign-in.
      window.location.assign(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to verify code.");
      setBusy(false);
    }
  }

  /** Complete the second-factor challenge. Only callable from the
   *  `mfa` stage - `verifyCode` set it after detecting a verified
   *  TOTP factor and an AAL1→AAL2 gap on the current session.
   *
   *  Accepts the code as an optional argument so the auto-submit
   *  effect can pass the just-typed value in the same render -
   *  calling without args reads `code` for the manual-submit path. */
  async function verifyMfa(explicit?: string) {
    if (stage.kind !== "mfa") return;
    setError(null);
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setError("Supabase isn't configured.");
      return;
    }

    const token = (explicit ?? code).trim();
    if (!/^\d{6}$/.test(token)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    try {
      const { error: e } = await supabase.auth.mfa.challengeAndVerify({
        factorId: stage.factorId,
        code: token,
      });
      if (e) throw e;

      // Session is now AAL2. If the user opted in, stash a sentinel
      // in sessionStorage so `SyncManager` records the trust on the
      // NEXT page after navigation. Doing the POST from here races
      // the AAL2 cookie write - Supabase chunks long session cookies
      // and the chunks haven't fully propagated to the browser cookie
      // jar when an immediate same-origin fetch fires, so proxy.ts
      // sees half-written chunks → "chunked cookie decoded to invalid
      // JSON" warnings → 401. Deferring one navigation lets cookies
      // settle. sessionStorage is per-tab and survives
      // window.location.assign, so the intent rides along cleanly.
      if (trustDevice) {
        try {
          window.sessionStorage.setItem("maqro:pending-trust", "1");
        } catch {
          // Restricted storage - the user just won't get the trust
          // recorded this cycle. They can opt in again on next MFA.
        }
      }

      window.location.assign(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to verify code.");
      setBusy(false);
    }
  }

  /** Auto-submit the MFA code the moment a 6th digit lands in the
   *  field. Most authenticator apps copy a fully-formed code to the
   *  clipboard so the user pastes - the manual "Sign in" click is
   *  one extra interaction with no value-add. The submit button
   *  stays visible as the fallback path. We track which exact code
   *  was already auto-fired so a verify-failure → user-fixes-one-
   *  digit-then-retypes loop doesn't spam `challengeAndVerify` with
   *  the same wrong code. */
  const autoSubmittedRef = useRef<string | null>(null);
  useEffect(() => {
    if (stage.kind !== "mfa") return;
    if (busy) return;
    if (code.length !== 6) {
      // Drop the guard the moment the field falls below 6 chars so
      // the next completion fires fresh.
      autoSubmittedRef.current = null;
      return;
    }
    if (autoSubmittedRef.current === code) return;
    autoSubmittedRef.current = code;
    void verifyMfa(code);
    // `verifyMfa` reads `stage` / `next` from this render's closure
    // - listing it in deps would re-fire the effect on every render
    // with no behavior change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, busy, stage.kind]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to app
          </Link>

          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
            <p className="text-sm text-muted-foreground">
              We&apos;ll email you a one-time code. No passwords.
            </p>
          </div>

          {searchParams.get("disconnected") === "1" && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              This device was disconnected from another device in your account.
              Sign in again to continue.
            </div>
          )}

          {!configured && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              Supabase isn&apos;t configured for this build. See README →
              Supabase setup to add the env vars.
            </div>
          )}

          {stage.kind === "mfa" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                verifyMfa();
              }}
              className="space-y-4"
            >
              <div
                role="status"
                className="space-y-2 rounded-md border border-border/60 bg-card px-4 py-3"
              >
                <p className="text-sm font-medium">Two-factor sign-in</p>
                <p className="text-xs text-muted-foreground">
                  Open your authenticator app and enter the 6-digit code for
                  this account.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="mfa-totp"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Code
                </Label>
                <div className="relative">
                  <Input
                    id="mfa-totp"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoFocus
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    onPaste={(e) => {
                      // Bypass maxLength truncation, which would eat
                      // valid digits when the pasted string contains
                      // leading/trailing whitespace. Strip non-digits
                      // and slice to the code length ourselves.
                      e.preventDefault();
                      const pasted = e.clipboardData
                        .getData("text")
                        .replace(/\D/g, "")
                        .slice(0, 6);
                      if (pasted) setCode(pasted);
                    }}
                    placeholder="••••••"
                    className="pr-10 font-mono tabular-nums text-center text-lg tracking-[0.3em]"
                    disabled={busy}
                  />
                  <PasteOtpButton
                    onPaste={setCode}
                    disabled={busy}
                  />
                </div>
              </div>
              {error && (
                <p
                  role="alert"
                  className="text-xs text-red-600"
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
                    Skip the authenticator step on this browser until then. You
                    can revoke from Settings.
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
                  onClick={() => {
                    // Bail back to email entry. The Supabase session
                    // is still at AAL1 - calling signOut here would
                    // be aggressive; leaving it lets the user retry
                    // the second factor without re-receiving the
                    // email code.
                    setStage({ kind: "request" });
                    setCode("");
                    setError(null);
                  }}
                >
                  Use a different email
                </button>
              </div>
            </form>
          ) : stage.kind === "request" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendCode();
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label
                  htmlFor="email"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={busy || !configured}
                />
              </div>
              {error && (
                <p
                  role="alert"
                  className="text-xs text-red-600"
                >
                  {error}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={busy || !configured}
              >
                {emailBusy ? "Sending…" : "Email me a code"}
              </Button>

              {/* Divider + Google OAuth alternative. Both flows
               *  land back at `/auth/callback`, which exchanges the
               *  code for a session cookie; the difference is just
               *  whether the user clicked a Supabase email link or
               *  a Google consent screen. */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border/60" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-background px-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    or
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                disabled={busy || !configured}
                onClick={() =>
                  void signInWithOAuthProvider(
                    "google",
                    setGoogleBusy,
                    "Google",
                  )
                }
              >
                <GoogleLogo className="h-4 w-4" />
                {googleBusy ? "Authenticating…" : "Continue with Google"}
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                disabled={busy || !configured}
                onClick={() =>
                  void signInWithOAuthProvider("apple", setAppleBusy, "Apple")
                }
              >
                <AppleLogo className="h-4 w-4" />
                {appleBusy ? "Authenticating…" : "Continue with Apple"}
              </Button>

              {/* Passkey button only renders on browsers that can
                  actually run the WebAuthn ceremony. Skipping the
                  feature check would surface a confusing OS-level
                  error the moment the user tapped a button their
                  browser can't honour. The other two methods stay
                  available regardless. */}
              {webauthnSupported && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2"
                  disabled={busy || !configured}
                  onClick={() => void signInWithPasskey()}
                >
                  <Fingerprint className="h-4 w-4" />
                  {passkeyBusy ? "Verifying…" : "Sign in with a passkey"}
                </Button>
              )}
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                verifyCode();
              }}
              className="space-y-4"
            >
              <div
                role="status"
                className="space-y-3 rounded-md border border-border/60 bg-card px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-medium">Check your email</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  We sent a sign-in email to{" "}
                  <span className="font-medium text-foreground">
                    {stage.email}
                  </span>
                  . You have two ways to continue:
                </p>
                {/* Each path gets a numbered tile with the choice
                 *  criterion up front. The link option is FIRST
                 *  because for ≥90% of sign-ins (same browser the
                 *  request was sent from) it's the faster path. The
                 *  code path is the cross-device escape hatch and
                 *  the only one that survives switching to a phone
                 *  to read the email. */}
                <ol className="space-y-2 text-xs text-muted-foreground">
                  <li className="flex gap-2">
                    <span
                      aria-hidden
                      className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[10px] font-semibold text-foreground"
                    >
                      1
                    </span>
                    <span>
                      <span className="font-medium text-foreground">
                        Click the link in the email.
                      </span>{" "}
                      Quickest path - only works on this browser, since the
                      verification cookie was set here.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span
                      aria-hidden
                      className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[10px] font-semibold text-foreground"
                    >
                      2
                    </span>
                    <span>
                      <span className="font-medium text-foreground">
                        Or paste the numeric code below.
                      </span>{" "}
                      Use this when you&apos;re reading the email on a phone and
                      signing in from another device.
                    </span>
                  </li>
                </ol>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="code"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Code
                </Label>
                <div className="relative">
                  <Input
                    id="code"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoFocus
                    autoComplete="one-time-code"
                    maxLength={10}
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 10))
                    }
                    placeholder="••••••••"
                    className="pr-11 font-mono tabular-nums text-center text-lg tracking-[0.3em]"
                    disabled={busy}
                  />
                  <button
                    type="button"
                    onClick={pasteCode}
                    disabled={busy}
                    className="absolute right-1 top-1/2 inline-flex h-7 w-9 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                    aria-label="Paste code from clipboard"
                    title="Paste code from clipboard"
                  >
                    <ClipboardPaste className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {error && (
                <p
                  role="alert"
                  className="text-xs text-red-600"
                >
                  {error}
                </p>
              )}

              <div className="flex flex-col gap-2">
                <Button
                  type="submit"
                  className="w-full"
                  disabled={busy || code.length < 4}
                >
                  {busy ? "Verifying…" : "Sign in"}
                </Button>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  disabled={busy}
                  onClick={() => {
                    setStage({ kind: "request" });
                    setError(null);
                  }}
                >
                  Use a different email
                </button>
              </div>
            </form>
          )}

          <p className="text-[11px] text-muted-foreground">
            You can keep using the app without signing in. Sign in to sync your
            data across devices.
          </p>

          <p className="text-[11px] text-muted-foreground">
            <Link
              href="/login/recovery"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Lost access to your email?
            </Link>{" "}
            Use the backup address you verified in Settings to recover.
          </p>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            By signing in, you confirm that you&apos;ve read and agree to the{" "}
            <Link
              href="/terms"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Terms
            </Link>{" "}
            and{" "}
            <Link
              href="/privacy"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Privacy Policy
            </Link>
            , including the health and data-handling disclaimers.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
