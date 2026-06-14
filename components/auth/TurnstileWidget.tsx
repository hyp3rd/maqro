"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

/** Form-side helper for the Turnstile challenge. Returns the current `token`
 *  (null until solved, or always-null when unconfigured), `ready` (safe to
 *  submit — true when unconfigured OR a token is in hand), `reset()` to call
 *  after a failed submit (a token is single-use), and `widgetProps` to spread
 *  onto `<TurnstileWidget />`. */
export function useTurnstile() {
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const reset = useCallback(() => {
    setToken(null);
    setResetKey((n) => n + 1);
  }, []);
  return {
    token,
    reset,
    ready: !SITE_KEY || token !== null,
    widgetProps: { onToken: setToken, resetKey },
  };
}

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Cloudflare Turnstile widget (managed mode — mostly invisible for legit
 *  users). Renders nothing when unconfigured. Calls `onToken` with a fresh
 *  token on solve and `onToken(null)` on expiry/error so the parent can re-gate
 *  its submit. Bump `resetKey` after a failed submit to mint a new token (a
 *  Turnstile token is single-use, so a retry needs a fresh challenge). */
export function TurnstileWidget({
  onToken,
  resetKey = 0,
}: {
  onToken: (token: string | null) => void;
  resetKey?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // Lazy initial value covers the "script already loaded" case (a second widget
  // mounting after the first loaded the script) WITHOUT a setState-in-effect.
  // On the server + at hydration the script hasn't loaded, so this is false on
  // both — no mismatch — then `onLoad` flips it once the script arrives.
  const [scriptReady, setScriptReady] = useState(
    () => typeof window !== "undefined" && Boolean(window.turnstile),
  );
  // The script failed to load (an ad blocker / network filter is the usual
  // cause now that the CSP allows the host). We stay fail-closed — submit stays
  // gated — but tell the user WHY, instead of a silently dead button.
  const [loadFailed, setLoadFailed] = useState(false);

  // Latest-callback ref so the render effect's deps stay minimal — re-rendering
  // the widget on every parent render would reset the challenge mid-solve.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  });

  // Render once the script is ready; remove on unmount.
  useEffect(() => {
    if (!SITE_KEY || !scriptReady || !containerRef.current) return;
    if (widgetId.current) return;
    const api = window.turnstile;
    if (!api) return;
    widgetId.current = api.render(containerRef.current, {
      sitekey: SITE_KEY,
      callback: (token: string) => onTokenRef.current(token),
      "expired-callback": () => onTokenRef.current(null),
      "error-callback": () => onTokenRef.current(null),
      "timeout-callback": () => onTokenRef.current(null),
    });
    return () => {
      if (widgetId.current) {
        try {
          api.remove(widgetId.current);
        } catch {
          // Already torn down by a navigation — nothing to clean up.
        }
        widgetId.current = null;
      }
    };
  }, [scriptReady]);

  // Re-challenge (fresh token) when the parent asks — e.g. after a failed
  // submit consumed the previous single-use token.
  useEffect(() => {
    if (resetKey === 0 || !widgetId.current || !window.turnstile) return;
    onTokenRef.current(null);
    try {
      window.turnstile.reset(widgetId.current);
    } catch {
      // No widget to reset (script hiccup); the next render re-establishes it.
    }
  }, [resetKey]);

  if (!SITE_KEY) return null;
  return (
    <>
      <Script
        src={SCRIPT_SRC}
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onError={() => setLoadFailed(true)}
      />
      <div
        ref={containerRef}
        className="hidden"
      />
      {loadFailed && (
        <p
          role="alert"
          className="text-xs text-destructive"
        >
          Couldn&apos;t load the security check — an ad blocker or network
          filter may be blocking it. Allow{" "}
          <span className="font-mono">challenges.cloudflare.com</span>, then
          reload.
        </p>
      )}
    </>
  );
}
