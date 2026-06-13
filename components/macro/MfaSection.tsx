"use client";

import { PasteOtpButton } from "@/components/auth/PasteOtpButton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonSettingRows } from "@/components/ui/skeleton";
import { useDisplayName } from "@/hooks/use-display-name";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import * as React from "react";
import { CheckCircle2, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FeatureIntro } from "./FeatureIntro";

/** Settings → Two-factor authentication.
 *
 *  Covers TOTP only.
 *
 *  Lifecycle:
 *
 *    - **loading** — initial `mfa.listFactors()` in flight.
 *    - **empty** — no enrolled TOTP factor. Shows the "Set up
 *      authenticator app" button. Clicking it transitions to
 *      `naming`.
 *    - **naming** — user picks a friendly label for the factor
 *      ("iPhone 1Password", "Work laptop", etc.) before we
 *      generate the secret. Doing this BEFORE the enroll call
 *      means the name lands on the row at insert time — no later
 *      patch + no orphan "Authenticator <date>" rows from users
 *      who back out after seeing the QR.
 *    - **enrolling** — `mfa.enroll()` returned an unverified
 *      factor. Renders the QR + manual secret + a 6-digit input.
 *      `challengeAndVerify()` on submit moves the user to
 *      `enrolled` (verified). Cancel cleans up via `unenroll()`
 *      so abandoned attempts don't accumulate.
 *    - **enrolled** — list verified factors with friendly name +
 *      "Remove" affordance.
 *    - **unavailable** — `enroll()` failed with "MFA is not
 *      enabled" (deployment-level Supabase setting). Renders a
 *      muted note instead of broken UI. */

type FactorRow = {
  id: string;
  friendlyName: string | null;
  status: "verified" | "unverified";
  factorType: string;
  createdAt: string;
};

type EnrollPayload = {
  factorId: string;
  qrCode: string;
  secret: string;
  uri: string;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "enrolled"; factors: FactorRow[] }
  // The user has clicked "Set up" or "Add another" but hasn't
  // yet committed to the enroll. They type a friendly label,
  // then click Continue to fire `enroll()` and transition to
  // `enrolling`. `previousFactors` carries the prior verified
  // list (when the user reached this state from `enrolled`) so
  // we can bounce back to the right post-cancel view without
  // re-fetching.
  | { kind: "naming"; previousFactors: FactorRow[] }
  | { kind: "enrolling"; payload: EnrollPayload; friendlyName: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; message: string };

/** Thin wrapper that owns the dismissable explainer + the
 *  `signedIn` gate. The actual TOTP plumbing — all six render
 *  branches plus enrollment ceremony — lives in `MfaSectionBody`
 *  unchanged. Wrapping at this boundary avoids threading
 *  `withIntro(...)` through every return inside the body. */
export function MfaSection({ signedIn }: { signedIn: boolean }) {
  const displayName = useDisplayName();
  if (!signedIn) return null;
  return (
    <div className="space-y-3">
      <FeatureIntro
        storageKey="mfa"
        icon={ShieldCheck}
        tint="amber"
        displayName={displayName}
        blurb="a second factor at sign-in means a leaked password alone can't get into your account — once enrolled, sign-in also asks for a 6-digit code from an authenticator app on your phone. Set it up once; you'll only be asked again on new devices."
      />
      <MfaSectionBody signedIn={signedIn} />
    </div>
  );
}

function MfaSectionBody({ signedIn }: { signedIn: boolean }) {
  const [state, setState] = React.useState<LoadState>({ kind: "loading" });
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState<
    "idle" | "enrolling" | "verifying" | "removing" | "canceling"
  >("idle");
  const [tick, setTick] = React.useState(0);
  // Controlled input for the `naming` step. Lifted to component
  // scope (not inline `useState` per render branch) so it survives
  // the transition between `empty` / `enrolled` and `naming`
  // without remounting.
  const [nameInput, setNameInput] = React.useState("");

  React.useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setState({ kind: "error", message: error.message });
        return;
      }
      const factors = mapFactors(data);
      setState(
        factors.length === 0
          ? { kind: "empty" }
          : { kind: "enrolled", factors },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, tick]);

  function refresh() {
    setTick((t) => t + 1);
  }

  /** Transition `empty` (or `enrolled`'s "Add another") → `naming`.
   *  We capture the current verified factors as `previousFactors`
   *  so the Cancel button can drop the user back into the right
   *  view without a refetch. */
  function beginNaming() {
    setNameInput("");
    setState((prev) => ({
      kind: "naming",
      previousFactors: prev.kind === "enrolled" ? prev.factors : [],
    }));
  }

  /** Cancel the naming step. If the user came from `enrolled`,
   *  drop them back there; if they came from `empty`, refresh
   *  (which will resolve to `empty` again unless they enrolled
   *  via another tab in the meantime). */
  function cancelNaming() {
    setState((prev) => {
      if (prev.kind !== "naming") return prev;
      return prev.previousFactors.length > 0
        ? { kind: "enrolled", factors: prev.previousFactors }
        : { kind: "empty" };
    });
    setNameInput("");
  }

  /** Commit the user-chosen label and start the TOTP enrollment.
   *
   *  Supabase rejects duplicate `friendly_name` values per user
   *  with a 422. Mounting the name on the row at INSERT time
   *  (rather than later via PATCH) means the rejection surfaces
   *  here cleanly rather than after the user has already scanned
   *  the QR. We trim the input and fall back to a timestamped
   *  label only if the user submits an empty string — defensive
   *  since the form should already enforce non-empty. */
  async function startEnroll(rawName: string) {
    const trimmed = rawName.trim();
    const fallback = `Authenticator ${new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })}`;
    const friendlyName = trimmed.length > 0 ? trimmed : fallback;
    setBusy("enrolling");
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setBusy("idle");
      return;
    }
    try {
      // Clean up dangling unverified factors from a previous abandoned
      // enrollment before minting a new one. Supabase keeps unverified
      // factors in `auth.mfa.factors` indefinitely — without this sweep
      // a user who closes the tab on the QR screen leaves a stale row
      // (and stale TOTP secret) lying around forever. The UI already
      // filters them out of the factor list, but the cleanup closes
      // the longer-term hygiene gap. Best-effort: a failure here can't
      // block a legitimate enrollment.
      try {
        const existing = await supabase.auth.mfa.listFactors();
        // The Supabase TS type narrows `status` to `"verified"` only,
        // but the runtime returns "unverified" rows too (per the
        // comment further down at the verify-side path). Cast through
        // a broader string union so the filter actually catches them.
        const stale = (existing.data?.totp ?? []).filter(
          (f) => (f.status as "verified" | "unverified") === "unverified",
        );
        for (const f of stale) {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      } catch {
        // Listing or removing failed (network, policy). Proceed with
        // enrollment anyway — the duplicate-name case is recoverable
        // by the user picking a different friendly name.
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName,
      });
      if (error) {
        // Supabase returns a specific message when MFA is disabled
        // at the project level. Surface that as a graceful empty
        // state rather than a generic error.
        if (/disabled|not enabled/i.test(error.message)) {
          setState({ kind: "unavailable", reason: error.message });
          return;
        }
        toast.error(error.message);
        return;
      }
      if (!data || data.type !== "totp") {
        toast.error("Unexpected enroll response. Try again.");
        return;
      }
      setState({
        kind: "enrolling",
        friendlyName,
        payload: {
          factorId: data.id,
          qrCode: data.totp.qr_code,
          secret: data.totp.secret,
          uri: data.totp.uri,
        },
      });
      setCode("");
    } finally {
      setBusy("idle");
    }
  }

  async function verifyEnroll(payload: EnrollPayload) {
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      toast.error("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy("verifying");
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setBusy("idle");
      return;
    }
    try {
      // `challengeAndVerify` packs create-challenge + verify into
      // one call. The verify side-effect promotes the current
      // session's AAL to `aal2` automatically.
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: payload.factorId,
        code: trimmed,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Two-factor authentication is now active.");
      refresh();
    } finally {
      setBusy("idle");
    }
  }

  async function cancelEnroll(payload: EnrollPayload) {
    setBusy("canceling");
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setBusy("idle");
      return;
    }
    try {
      // Unverified factors stick around if we don't clean them up,
      // and they're confusing (`listFactors` returns them too).
      // Best-effort: ignore errors — worst case is one orphan row
      // the user can delete from the enrolled list later.
      await supabase.auth.mfa.unenroll({ factorId: payload.factorId });
      setCode("");
      refresh();
    } finally {
      setBusy("idle");
    }
  }

  async function removeFactor(factorId: string) {
    setBusy("removing");
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setBusy("idle");
      return;
    }
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Authenticator removed.");
      refresh();
    } finally {
      setBusy("idle");
    }
  }

  if (!signedIn) return null;

  const header = (
    <header className="border-b border-border/60 px-5 py-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        Two-factor authentication
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        A second factor at sign-in — a 6-digit code from an authenticator app
        like 1Password, Authy, or Google Authenticator.
      </p>
    </header>
  );

  if (state.kind === "loading") {
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {header}
        <SkeletonSettingRows rows={2} />
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {header}
        <p
          role="alert"
          className="px-5 py-4 text-xs text-red-600"
        >
          {state.message}
        </p>
      </section>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {header}
        <p className="px-5 py-4 text-xs text-muted-foreground">
          Two-factor authentication isn&apos;t available on this instance.
          Contact the administrator to enable it.
        </p>
      </section>
    );
  }

  if (state.kind === "enrolling") {
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {header}
        <div className="space-y-4 px-5 py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {/* Plain <img> on purpose. Two reasons next/image
             *  doesn't fit here:
             *    - Supabase returns the QR as an inline
             *      `data:image/svg+xml;…` URI. Next.js's image
             *      pipeline blocks SVG by default (SVGs can contain
             *      executable script — `dangerouslyAllowSVG` exists
             *      but enabling it globally for one widget would
             *      lower the security baseline for every image on
             *      the site).
             *    - Even with `unoptimized`, next/image still
             *      validates the source against the loader's
             *      allowlist and rejects unknown content-types.
             *
             *  The lint rule's concerns (LCP, network bandwidth)
             *  don't apply to a same-document data URI rendered
             *  only inside the enrollment flow. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- justified above: inline data: URI from a trusted server source; next/image rejects SVG without lowering the global security baseline */}
            <img
              src={state.payload.qrCode}
              alt="Authenticator QR code"
              width={160}
              height={160}
              className="shrink-0 self-center rounded-md border border-border/60 bg-white p-1"
            />
            <div className="min-w-0 space-y-2 text-xs">
              <p>
                <span className="font-medium text-foreground">
                  Scan with your authenticator app
                </span>{" "}
                or paste the secret below if scanning isn&apos;t available.
              </p>
              <code className="block break-all rounded bg-muted/40 px-2 py-1.5 font-mono text-[11px]">
                {state.payload.secret}
              </code>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label
                htmlFor="mfa-code"
                className="text-xs font-medium text-muted-foreground"
              >
                Enter the 6-digit code from the app
              </Label>
              <div className="relative">
                <Input
                  id="mfa-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  onPaste={(e) => {
                    // Same paste-bypass as the other two MFA inputs
                    // (sign-in MFA stage, MfaChallengeDialog) — paste
                    // with leading/trailing whitespace would otherwise
                    // be truncated by maxLength before our regex
                    // could strip it.
                    e.preventDefault();
                    const pasted = e.clipboardData
                      .getData("text")
                      .replace(/\D/g, "")
                      .slice(0, 6);
                    if (pasted) setCode(pasted);
                  }}
                  placeholder="••••••"
                  className="pr-10 font-mono tabular-nums tracking-[0.3em] text-center"
                  disabled={busy !== "idle"}
                />
                <PasteOtpButton
                  onPaste={setCode}
                  disabled={busy !== "idle"}
                />
              </div>
            </div>
            <Button
              type="button"
              onClick={() => verifyEnroll(state.payload)}
              disabled={code.length !== 6 || busy !== "idle"}
              className="h-9 shrink-0"
            >
              {busy === "verifying" ? "Verifying…" : "Verify and enable"}
            </Button>
          </div>

          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={() => cancelEnroll(state.payload)}
            disabled={busy !== "idle"}
          >
            Cancel and remove this pending factor
          </button>
        </div>
      </section>
    );
  }

  if (state.kind === "empty") {
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {header}
        <div className="flex animate-in flex-col gap-3 px-5 py-4 fade-in duration-300 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Not set up. Adding a second factor makes it materially harder for
            anyone to take over your account, even if they intercept your
            sign-in email.
          </p>
          <Button
            type="button"
            onClick={beginNaming}
            disabled={busy !== "idle"}
            size="sm"
            className="h-8 shrink-0 gap-1.5"
          >
            <KeyRound className="h-3.5 w-3.5" />
            Set up authenticator app
          </Button>
        </div>
      </section>
    );
  }

  if (state.kind === "naming") {
    // Friendly-name picker — first stage of TOTP enrollment.
    // Submit commits the name + fires `enroll()`.
    const trimmed = nameInput.trim();
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {header}
        <form
          className="space-y-3 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed.length === 0 || busy !== "idle") return;
            void startEnroll(trimmed);
          }}
        >
          <div className="space-y-1.5">
            <Label
              htmlFor="mfa-friendly-name"
              className="text-xs font-medium text-muted-foreground"
            >
              Name this authenticator
            </Label>
            <Input
              id="mfa-friendly-name"
              autoFocus
              autoComplete="off"
              maxLength={64}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="iPhone 1Password, Work laptop, …"
              disabled={busy !== "idle"}
            />
            <p className="text-[11px] text-muted-foreground">
              You&apos;ll see this label when you sign in and in the list below.
              Pick something that tells you which device this is.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={trimmed.length === 0 || busy !== "idle"}
              className="h-8 gap-1.5"
            >
              <KeyRound className="h-3.5 w-3.5" />
              {busy === "enrolling" ? "Starting…" : "Continue"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={cancelNaming}
              disabled={busy !== "idle"}
              className="h-8"
            >
              Cancel
            </Button>
          </div>
        </form>
      </section>
    );
  }

  // Enrolled branch — list verified factors. Unverified ones (from
  // an abandoned enroll session) are filtered out for clarity; the
  // user can remove them by starting fresh and clicking Cancel.
  if (state.kind !== "enrolled") return null;
  const verified = state.factors.filter((f) => f.status === "verified");
  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      {header}
      <ul className="divide-y divide-border/60">
        {verified.map((f) => (
          <li
            key={f.id}
            className="flex items-center justify-between gap-3 px-5 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="font-medium">
                  {f.friendlyName ?? "Authenticator"}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {f.factorType}
                </span>
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Added {new Date(f.createdAt).toLocaleDateString()}
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1.5 border-red-500/40 text-red-700 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-400"
                  disabled={busy === "removing"}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this factor?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Once removed, your next sign-in will only require the email
                    code. You can re-enroll any time, but the authenticator app
                    secret will be different.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy === "removing"}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      void removeFactor(f.id);
                    }}
                    disabled={busy === "removing"}
                  >
                    {busy === "removing" ? "Removing…" : "Remove"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </li>
        ))}
      </ul>
      <div className="border-t border-border/60 px-5 py-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={beginNaming}
          disabled={busy !== "idle"}
          className="h-8 gap-1.5"
        >
          <KeyRound className="h-3.5 w-3.5" />
          Add another
        </Button>
      </div>
    </section>
  );
}

/** Normalize the shape supabase.auth.mfa.listFactors returns into
 *  the row shape this component consumes. Lifted out so the test
 *  suite can drive it directly without going through the whole
 *  client.
 *
 *  Supabase returns `{ all, totp, phone, … }` — keyed subsets per
 *  factor type plus an `all` rollup. We render `totp` only since
 *  this section is TOTP-scoped. */
type ListFactorsData = Awaited<
  ReturnType<SupabaseClient["auth"]["mfa"]["listFactors"]>
>["data"];

function mapFactors(data: ListFactorsData): FactorRow[] {
  if (!data) return [];
  return data.totp.map((f) => ({
    id: f.id,
    friendlyName: f.friendly_name ?? null,
    status: f.status as "verified" | "unverified",
    factorType: f.factor_type,
    createdAt: f.created_at,
  }));
}
