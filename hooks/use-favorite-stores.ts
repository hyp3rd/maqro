"use client";

import {
  deleteFavoriteStore,
  listFavoriteStores,
  upsertFavoriteStore,
  type FavoriteStore,
} from "@/lib/db";
import { reportStorageError } from "@/lib/storage-status";
import { bumpPending } from "@/lib/sync-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { useCallback, useEffect, useMemo, useState } from "react";

/** The fields needed to star a store — a `NearbyStore` minus the
 *  ephemeral distance. */
export type StorableStore = Pick<
  FavoriteStore,
  "id" | "name" | "kind" | "lat" | "lon" | "address"
>;

export type UseFavoriteStores = {
  favorites: FavoriteStore[];
  /** Set of favourited store ids, for "is this starred?" checks. */
  favIds: Set<string>;
  /** Star if not saved, unstar if saved. */
  toggle: (store: StorableStore) => Promise<void>;
  /** Re-add a store (for an Undo after un-favouriting). */
  add: (store: StorableStore) => Promise<void>;
};

/** Synced favourite-store list + a star toggle. Re-reads on every
 *  realtime arrival via `useDataRev`, the same pattern PantryView uses.
 *  Mutations write through the IDB CRUD helpers, bump the sync pill, and
 *  notify the data bus so every mounted consumer (the star in
 *  NearbyStores + the FavoriteStores panel) refreshes together. */
export function useFavoriteStores(): UseFavoriteStores {
  const rev = useDataRev("favoriteStores");
  const [favorites, setFavorites] = useState<FavoriteStore[]>([]);

  useEffect(() => {
    let cancelled = false;
    listFavoriteStores()
      .then((rows) => {
        if (!cancelled) setFavorites(rows);
      })
      .catch(() => {
        // No favourites on this session; non-fatal.
      });
    return () => {
      cancelled = true;
    };
  }, [rev]);

  const favIds = useMemo(
    () => new Set(favorites.map((f) => f.id)),
    [favorites],
  );

  const toggle = useCallback(
    async (store: StorableStore) => {
      try {
        if (favIds.has(store.id)) {
          await deleteFavoriteStore(store.id);
        } else {
          await upsertFavoriteStore(store);
        }
        // The db helpers bus `favoriteStores` themselves; just bump the
        // sync pill so the unsynced edit is visible.
        bumpPending();
      } catch (err) {
        reportStorageError(err);
      }
    },
    [favIds],
  );

  /** Re-add a store (for an Undo after un-favouriting). Stable (no favIds dep)
   *  so a deferred Undo callback re-adds rather than re-toggling stale state. */
  const add = useCallback(async (store: StorableStore) => {
    try {
      await upsertFavoriteStore(store);
      bumpPending();
    } catch (err) {
      reportStorageError(err);
    }
  }, []);

  return { favorites, favIds, toggle, add };
}
