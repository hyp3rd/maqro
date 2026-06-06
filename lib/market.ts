import { isMarketCode, type MarketCode } from "@/lib/markets";
import { useSyncExternalStore } from "react";

/** Shopping-market resolution, in precedence order:
 *
 *   1. **Device override** — `localStorage["maqro:market"]`, set by the
 *      on-the-go switcher in the food-search sheet. Per-device, wins locally.
 *   2. **Home market** — the synced `PersonalInfo.market`, mirrored in via
 *      `setHomeMarket` by the profile owner. Follows the user across devices.
 *   3. **Browser region** — `navigator.language` (`de-DE` → `DE`), else
 *      `"world"` (no bias = today's behaviour).
 *
 *  Mirrors `lib/sync-mode.ts`: a `useSyncExternalStore` subscriber so every
 *  consumer re-renders on a change (and cross-tab via the `storage` event). */

const MARKET_KEY = "maqro:market";

/** Synced home market, mirrored from the profile by `setHomeMarket`. Module
 *  scope (not React state) so the non-hook `getMarket` + the server snapshot
 *  can read it too. */
let homeMarket: MarketCode | undefined;

/** The browser's explicit region, if it maps to a supported market. Bare
 *  languages (`en`, `de` with no region) fall back to "world" — we don't guess
 *  a country from the language alone. */
function browserMarket(): MarketCode {
  try {
    const region = new Intl.Locale(navigator.language).region;
    if (region && isMarketCode(region)) return region;
  } catch {
    /* navigator / Intl.Locale unavailable */
  }
  return "world";
}

/** The device override, or null when deferring to the home/browser default. */
function readOverride(): MarketCode | null {
  try {
    const v = localStorage.getItem(MARKET_KEY);
    if (v && isMarketCode(v)) return v;
  } catch {
    /* storage disabled (private mode) */
  }
  return null;
}

/** The market with no device override: the synced home market, else the
 *  browser region. */
function readDefault(): MarketCode {
  return homeMarket ?? browserMarket();
}

function readMarket(): MarketCode {
  return readOverride() ?? readDefault();
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

function emit(): void {
  for (const l of listeners) l();
}

/** Mirror the synced profile's home market so the resolution can use it as the
 *  default (below the device override, above the browser region). Called by the
 *  profile owner whenever `PersonalInfo.market` loads or changes. An invalid /
 *  absent value clears it (→ browser region). */
export function setHomeMarket(code: string | undefined): void {
  const next = code && isMarketCode(code) ? code : undefined;
  if (homeMarket === next) return;
  homeMarket = next;
  emit();
}

export function getMarket(): MarketCode {
  return readMarket();
}

/** Set the per-device override (the on-the-go switcher). */
export function setMarket(code: MarketCode): void {
  try {
    localStorage.setItem(MARKET_KEY, code);
  } catch {
    /* storage disabled */
  }
  emit();
}

/** Drop the per-device override, deferring back to the home/browser default. */
export function clearMarketOverride(): void {
  try {
    localStorage.removeItem(MARKET_KEY);
  } catch {
    /* storage disabled */
  }
  emit();
}

/** Constant on the server so SSR never touches `navigator` / `localStorage`;
 *  the client resolves the real value on hydration. */
function getServerSnapshot(): MarketCode {
  return "world";
}

/** The resolved active market (override → home → browser). */
export function useMarket(): MarketCode {
  return useSyncExternalStore(subscribe, readMarket, getServerSnapshot);
}

/** The active device override, or null when deferring to the home/browser
 *  default — lets the switcher show whether "Automatic" is selected. */
export function useMarketOverride(): MarketCode | null {
  return useSyncExternalStore(subscribe, readOverride, () => null);
}

/** The market "Automatic" resolves to — the synced home market, else the
 *  browser region (the resolution ignoring any device override). Lets the
 *  switcher label "Automatic" with the country it currently defers to. */
export function useDefaultMarket(): MarketCode {
  return useSyncExternalStore(subscribe, readDefault, getServerSnapshot);
}
