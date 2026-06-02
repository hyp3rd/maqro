"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** Returns `false` during SSR and the first client render, then `true`
 *  after hydration — without a setState-in-effect that
 *  `react-hooks/set-state-in-effect` flags. Use to gate rendering of
 *  values that only exist on the client (theme, locale-formatted dates)
 *  so server and first-render markup stay identical and hydration is
 *  clean. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
