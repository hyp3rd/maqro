"use client";

import type { Food } from "@/components/macro/types";
import {
  addFavoriteFood,
  deleteFavoriteFoodByName,
  listFavoriteFoods,
  type FavoriteFood,
} from "@/lib/db";
import { reportStorageError } from "@/lib/storage-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { useCallback, useEffect, useMemo, useState } from "react";

/** The user's pinned favourite foods + a star toggle. Re-reads on every
 *  `favoriteFoods` data-bus bump (local edits and realtime arrivals), so
 *  the star state and the Favourites list stay in sync everywhere. */
export function useFavoriteFoods(): {
  favorites: FavoriteFood[];
  isFavorite: (name: string) => boolean;
  toggle: (food: Food, portion: number) => Promise<void>;
} {
  const [favorites, setFavorites] = useState<FavoriteFood[]>([]);
  const rev = useDataRev("favoriteFoods");

  useEffect(() => {
    let cancelled = false;
    listFavoriteFoods()
      .then((rows) => {
        if (!cancelled) setFavorites(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        reportStorageError(err);
        setFavorites([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rev]);

  const keys = useMemo(
    () => new Set(favorites.map((f) => f.nameKey)),
    [favorites],
  );

  const isFavorite = useCallback(
    (name: string) => keys.has(name.trim().toLowerCase()),
    [keys],
  );

  const toggle = useCallback(
    async (food: Food, portion: number) => {
      try {
        if (keys.has(food.name.trim().toLowerCase())) {
          await deleteFavoriteFoodByName(food.name);
        } else {
          await addFavoriteFood(food, portion);
        }
      } catch (err) {
        reportStorageError(err);
      }
    },
    [keys],
  );

  return { favorites, isFavorite, toggle };
}
