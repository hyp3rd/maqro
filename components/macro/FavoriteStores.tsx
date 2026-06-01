"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFavoriteStores } from "@/hooks/use-favorite-stores";
import { storeDirectionsUrl } from "@/lib/shopping/nearby";
import { Navigation, Star } from "lucide-react";

/** The user's starred grocery stores, synced across devices. Shown in
 *  the otherwise-empty space beside the shopping list (and under the
 *  Shop-for-me nearby section). Hidden entirely when there are none.
 *  Directions omit an origin, so Maps routes from the device's current
 *  location. */
export function FavoriteStores() {
  const { favorites, toggle } = useFavoriteStores();
  if (favorites.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
        Favourite stores
      </h4>
      <ul className="divide-y divide-border/60 rounded-md border border-border/60">
        {favorites.map((store) => (
          <li
            key={store.id}
            className="flex items-center gap-2 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {store.name}
                </span>
                <Badge
                  variant="secondary"
                  className="shrink-0 text-[10px] uppercase tracking-wide"
                >
                  {store.kind}
                </Badge>
              </div>
              {store.address && (
                <p className="truncate text-xs text-muted-foreground">
                  {store.address}
                </p>
              )}
            </div>
            <a
              href={storeDirectionsUrl(store, null)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <Navigation className="h-3 w-3" />
              Directions
            </a>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-amber-500"
              aria-label={`Remove ${store.name} from favourites`}
              onClick={() =>
                void toggle({
                  id: store.id,
                  name: store.name,
                  kind: store.kind,
                  lat: store.lat,
                  lon: store.lon,
                  address: store.address,
                })
              }
            >
              <Star className="h-3.5 w-3.5 fill-amber-400" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
