"use client";

import * as React from "react";

/** Whether the day view's Fasting card is on screen, shared between the
 *  card (inside the page) and the Topbar's fasting chip (outside it): the
 *  chip repeats the card's countdown, so it steps aside while the card can
 *  be seen and comes back once the card scrolls away or isn't rendered. */
type Visibility = {
  onScreen: boolean;
  setOnScreen: (onScreen: boolean) => void;
};

const FastingCardVisibility = React.createContext<Visibility | null>(null);

/** Holds the card's on-screen state for the app shell (AppShell). */
export function FastingCardVisibilityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [onScreen, setOnScreen] = React.useState(false);
  const value = React.useMemo(() => ({ onScreen, setOnScreen }), [onScreen]);
  return (
    <FastingCardVisibility value={value}>{children}</FastingCardVisibility>
  );
}

/** Whether the Fasting card is on screen now (false outside a provider). */
export function useFastingCardOnScreen(): boolean {
  return React.useContext(FastingCardVisibility)?.onScreen ?? false;
}

/** A callback ref for the Fasting card's root element: reports whether any
 *  of it intersects the viewport, and that it is gone once it unmounts.
 *  Without a provider, or in a browser without IntersectionObserver, it
 *  reports nothing and the chip simply stays. */
export function useFastingCardRef(): React.RefCallback<HTMLElement> {
  const setOnScreen = React.useContext(FastingCardVisibility)?.setOnScreen;
  return React.useCallback(
    (el: HTMLElement | null) => {
      if (!el || !setOnScreen || typeof IntersectionObserver === "undefined") {
        return;
      }
      const observer = new IntersectionObserver((entries) => {
        const entry = entries.at(-1);
        if (entry) setOnScreen(entry.isIntersecting);
      });
      observer.observe(el);
      return () => {
        observer.disconnect();
        setOnScreen(false);
      };
    },
    [setOnScreen],
  );
}
