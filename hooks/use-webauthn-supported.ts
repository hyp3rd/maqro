"use client";

import { useSyncExternalStore } from "react";

/** Feature-detects WebAuthn / passkey support.
 *
 *  Returns `true` when the browser exposes `window.PublicKeyCredential`,
 *  i.e. it can run the WebAuthn ceremony Supabase's `signInWithPasskey`
 *  + `registerPasskey` rely on. Returns `false` everywhere else,
 *  including SSR (the server has no notion of the user's browser
 *  capabilities), reduced-environment WebViews without WebAuthn, and
 *  pre-2017 browsers.
 *
 *  We hide the passkey UI behind this so users on incompatible
 *  browsers don't see an option that would fail with a confusing
 *  error the moment they tap it. The other auth methods (magic link,
 *  Google OAuth) remain available regardless.
 *
 *  Implemented via `useSyncExternalStore` to satisfy React 19's
 *  `react-hooks/set-state-in-effect` rule. WebAuthn support doesn't
 *  flip at runtime, so `subscribe` is a no-op — the snapshot decides
 *  on mount and never changes. */
function subscribe(): () => void {
  return () => undefined;
}

function getSnapshot(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined"
  );
}

function getServerSnapshot(): boolean {
  return false;
}

export function useWebAuthnSupported(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
