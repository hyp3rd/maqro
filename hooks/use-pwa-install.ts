"use client";

import { useEffect, useState } from "react";

/** The `beforeinstallprompt` event isn't in TS's standard lib yet.
 *  Defined locally so consumers don't have to cast. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export type PwaInstallState = {
  /** Chrome/Edge/Android only — true once the browser has fired
   *  the `beforeinstallprompt` event (it's eligible AND the user
   *  hasn't already installed). iOS and Firefox never set this. */
  canInstall: boolean;
  /** iOS Safari needs a different install gesture (Share → Add to
   *  Home Screen) — set when we detect the user is on iOS and the
   *  app isn't already running in standalone mode. */
  isIOS: boolean;
  /** True when the app is already running as an installed PWA
   *  (`display-mode: standalone` matches, or Safari's
   *  `navigator.standalone` is true). When this is true the
   *  install prompt should never render. */
  isInstalled: boolean;
  /** Trigger the native install flow. Resolves to whether the
   *  user accepted. No-ops + resolves `false` when called outside
   *  the `canInstall=true` window (the browser only allows the
   *  prompt once per event firing). */
  install: () => Promise<boolean>;
};

/** Wires the `beforeinstallprompt` event into React state. The
 *  event fires asynchronously after page load — Chrome only emits
 *  it once site-engagement heuristics pass (e.g., 30 s of active
 *  time on the site). Until then, `canInstall` is false even on a
 *  perfectly-installable PWA.
 *
 *  iOS Safari has no equivalent event — we detect the platform
 *  and surface manual instructions instead. */
function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

function detectIOS(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent.toLowerCase();
  const iosUa = /iphone|ipad|ipod/.test(ua);
  // iPadOS impersonates macOS — the touch-points hint catches that.
  const isTouchMac = ua.includes("mac") && navigator.maxTouchPoints > 1;
  return iosUa || isTouchMac;
}

export function usePwaInstall(): PwaInstallState {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  // Lazy initializers so we read the platform values once at mount
  // instead of via a setState-in-effect (forbidden by the lint
  // rule). SSR returns false for both — that's fine, the install
  // banner is purely a client-side UI affordance.
  const [installed, setInstalled] = useState<boolean>(detectStandalone);
  const [isIOS] = useState<boolean>(detectIOS);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      // Suppress the default mini-infobar so we can prompt from
      // our own UI when the user clicks Install.
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // Listen for successful installs so we hide the prompt
    // immediately rather than waiting for the next page load.
    const installedHandler = () => {
      setInstalled(true);
      setEvent(null);
    };
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  async function install(): Promise<boolean> {
    if (!event) return false;
    await event.prompt();
    const choice = await event.userChoice;
    // The event is single-use — clear it whether accepted or
    // dismissed so subsequent clicks don't try to re-use a
    // consumed prompt (Chrome throws).
    setEvent(null);
    return choice.outcome === "accepted";
  }

  return {
    canInstall: event !== null && !installed,
    isIOS: isIOS && !installed,
    isInstalled: installed,
    install,
  };
}
