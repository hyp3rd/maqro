"use client";

import type { Food } from "@/components/macro/types";
import { foodDatabase } from "@/data/food-database";
import { searchCustomFoods } from "@/lib/db";
import { searchOpenFoodFacts } from "@/lib/openfoodfacts";
import { useEffect, useMemo, useRef, useState } from "react";

const DEBOUNCE_MS = 300;
const LOCAL_LIMIT = 5;
const OFF_LIMIT = 8;

export type FoodSearchState = {
  query: string;
  results: Food[];
  isSearchingRemote: boolean;
  remoteError: string | null;
};

/** Internal async-loaded state. `for` tracks which query this data belongs to;
 * if it differs from the current query, the data is stale. */
type AsyncState = {
  for: string;
  custom: Food[];
  off: Food[];
  remoteDone: boolean;
  remoteError: string | null;
};

const EMPTY_ASYNC: AsyncState = {
  for: "",
  custom: [],
  off: [],
  remoteDone: true,
  remoteError: null,
};

/** Search builtin + custom (IndexedDB) + Open Food Facts in parallel. The
 * builtin source resolves synchronously during render; custom + OFF arrive
 * asynchronously and merge in. `customRev` lets callers force a re-query
 * after saving a new custom food. */
export function useFoodSearch(query: string, customRev = 0): FoodSearchState {
  const trimmed = query.trim();
  const [asyncState, setAsyncState] = useState<AsyncState>(EMPTY_ASYNC);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!trimmed) {
      abortRef.current?.abort();
      return;
    }
    let cancelled = false;

    searchCustomFoods(trimmed, LOCAL_LIMIT)
      .then((custom) => {
        if (cancelled) return;
        setAsyncState((prev) =>
          prev.for === trimmed
            ? { ...prev, custom }
            : {
                for: trimmed,
                custom,
                off: [],
                remoteDone: false,
                remoteError: null,
              },
        );
      })
      .catch(() => {
        // IndexedDB unavailable (e.g. private mode) — degrade silently.
      });

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const timer = window.setTimeout(() => {
      searchOpenFoodFacts(trimmed, {
        signal: controller.signal,
        limit: OFF_LIMIT,
      })
        .then((off) => {
          if (cancelled || controller.signal.aborted) return;
          setAsyncState((prev) =>
            prev.for === trimmed
              ? { ...prev, off, remoteDone: true }
              : {
                  for: trimmed,
                  custom: [],
                  off,
                  remoteDone: true,
                  remoteError: null,
                },
          );
        })
        .catch((err: unknown) => {
          if (cancelled || controller.signal.aborted) return;
          const message = err instanceof Error ? err.message : "OFF error";
          setAsyncState((prev) =>
            prev.for === trimmed
              ? { ...prev, remoteDone: true, remoteError: message }
              : prev,
          );
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [trimmed, customRev]);

  const builtin = useMemo(
    () => (trimmed ? searchBuiltin(trimmed, LOCAL_LIMIT) : []),
    [trimmed],
  );

  const results = useMemo(() => {
    if (!trimmed) return [];
    const fresh = asyncState.for === trimmed;
    const custom = fresh ? asyncState.custom : [];
    const off = fresh ? asyncState.off : [];
    return merge(custom, builtin, off);
  }, [trimmed, builtin, asyncState]);

  if (!trimmed) {
    return {
      query: "",
      results: [],
      isSearchingRemote: false,
      remoteError: null,
    };
  }

  const isSearchingRemote =
    asyncState.for !== trimmed || !asyncState.remoteDone;
  const remoteError =
    asyncState.for === trimmed ? asyncState.remoteError : null;

  return { query: trimmed, results, isSearchingRemote, remoteError };
}

function searchBuiltin(query: string, limit: number): Food[] {
  const q = query.toLowerCase();
  return foodDatabase
    .filter((f) => f.name.toLowerCase().includes(q))
    .slice(0, limit)
    .map((f) => ({
      ...f,
      id: f.id ?? `builtin:${f.name}`,
      source: "builtin" as const,
    }));
}

/** Custom first (user knows them), then builtin, then OFF. Dedup by name
 * (case-insensitive) so a custom "Apple" hides the builtin one. */
function merge(custom: Food[], builtin: Food[], off: Food[]): Food[] {
  const seen = new Set<string>();
  const out: Food[] = [];
  for (const list of [custom, builtin, off]) {
    for (const food of list) {
      const key = food.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(food);
    }
  }
  return out;
}
