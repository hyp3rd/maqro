import { isMarketCode, type MarketCode } from "@/lib/markets";
import { useSyncExternalStore } from "react";

/** Device-local "shopping market" preference. Mirrors `lib/sync-mode.ts`: a
 *  localStorage value plus a `useSyncExternalStore` subscriber so every consumer
 *  re-renders on a change (and cross-tab via the `storage` event).
 *
 *  Device-local, NOT synced to the account — which market you're shopping in is
 *  contextual to where you are right now (think travel), so switching it on one
 *  device shouldn't override the others. Defaults from the browser's explicit
 *  region (`navigator.language`, e.g. `de-DE` → `DE`), falling back to "world"
 *  (no bias = today's behaviour) when there's no confidently-mappable region. */

const MARKET_KEY = "maqro:market";

/** The browser's explicit region, if it maps to a market we support. Bare
 *  languages (`en`, `de` with no region) intentionally fall back to "world" —
 *  we don't guess a country from the language alone. */
function defaultMarket(): MarketCode {
  try {
    const region = new Intl.Locale(navigator.language).region;
    if (region && isMarketCode(region)) return region;
  } catch {
    /* navigator / Intl.Locale unavailable */
  }
  return "world";
}

function readMarket(): MarketCode {
  try {
    const v = localStorage.getItem(MARKET_KEY);
    if (v && isMarketCode(v)) return v;
  } catch {
    /* storage disabled (private mode) */
  }
  return defaultMarket();
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === MARKET_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function getMarket(): MarketCode {
  return readMarket();
}

export function setMarket(code: MarketCode): void {
  try {
    localStorage.setItem(MARKET_KEY, code);
  } catch {
    /* storage disabled */
  }
  for (const l of listeners) l();
}

/** Constant on the server so SSR never touches `navigator` / `localStorage`;
 *  the client resolves the real value on hydration. */
function getServerSnapshot(): MarketCode {
  return "world";
}

export function useMarket(): MarketCode {
  // `readMarket` returns a primitive string, stable by value under `Object.is`,
  // so it doubles safely as the snapshot getter (no memoized cache needed).
  return useSyncExternalStore(subscribe, readMarket, getServerSnapshot);
}
