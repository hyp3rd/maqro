"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useFavoriteStores } from "@/hooks/use-favorite-stores";
import {
  formatDistance,
  storeDirectionsUrl,
  type GeocodeResult,
  type NearbyStore,
} from "@/lib/shopping/nearby";
import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Navigation, Star } from "lucide-react";

type Status = "idle" | "busy" | "ready" | "error";
type Coords = { lat: number; lon: number };

/** Radius pills offered in the results dialog. Match the API's
 *  MIN/MAX bounds (500 m–10 km); 3 km is the default — about a
 *  10–15 minute walk in dense urban areas and a 2-minute drive in
 *  suburban ones, which covers most realistic "where do I shop"
 *  queries. */
const RADIUS_PRESETS_M = [500, 1000, 3000, 5000, 10000] as const;
type RadiusM = (typeof RADIUS_PRESETS_M)[number];
const DEFAULT_RADIUS_M: RadiusM = 3000;
function formatRadiusLabel(m: RadiusM): string {
  return m < 1000 ? `${m} m` : `${m / 1000} km`;
}

/** "Load more" page size. Each press grows the upstream slice by
 *  this much. Server caps at 100 total. */
const LOAD_MORE_STEP = 15;
const INITIAL_LIMIT = 15;

/** "Find grocery stores near me": either the browser's geolocation or a
 *  typed address (autocompleted + geocoded via our keyless Photon proxy)
 *  feeds the keyless Overpass proxy. The store list opens in a
 *  height-capped overlay (not an inline flood) with a Maps directions
 *  link routed from the chosen origin. Location is requested only on the
 *  button press and never stored. Embedded in both the Shop-for-me
 *  dialog and the Shopping List view. */
export function NearbyStores() {
  const [status, setStatus] = useState<Status>("idle");
  const [stores, setStores] = useState<NearbyStore[]>([]);
  const [error, setError] = useState<string>("");
  const [origin, setOrigin] = useState<string>("");
  const [originCoords, setOriginCoords] = useState<Coords | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);

  const [address, setAddress] = useState<string>("");
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [radius, setRadius] = useState<RadiusM>(DEFAULT_RADIUS_M);
  const [limit, setLimit] = useState<number>(INITIAL_LIMIT);
  /** When true, the upstream returned `limit` exactly — there may be
   *  more results behind the slice. Driven from the response length;
   *  we use `>=` rather than `===` so a server-side dedup that drops
   *  one row before slicing still allows the user to ask for more. */
  const [hasMore, setHasMore] = useState<boolean>(false);
  const { favIds, toggle } = useFavoriteStores();
  // Set when the user picks a suggestion, so the debounce effect doesn't
  // immediately re-open the dropdown for the text we just filled in.
  const justPicked = useRef(false);

  // Debounced address autocomplete against the Photon proxy.
  useEffect(() => {
    const q = address.trim();
    if (justPicked.current) {
      justPicked.current = false;
      return;
    }
    const controller = new AbortController();
    // All state updates happen inside the deferred timer (never
    // synchronously in the effect body) to stay clear of
    // react-hooks/set-state-in-effect.
    const timer = window.setTimeout(() => {
      if (q.length < 3) {
        setSuggestions([]);
        return;
      }
      fetch(`/api/shopping/geocode?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : { results: [] }))
        .then((data: { results: GeocodeResult[] }) => {
          setSuggestions(data.results ?? []);
        })
        .catch(() => {
          // Aborted or network error — leave suggestions as-is.
        });
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [address]);

  /** Shared tail: given coordinates, fetch nearby stores and open
   *  the results overlay. `nextLimit` lets the "Load more" path
   *  re-fetch the same origin with a higher slice without rebinding
   *  the origin label / coords. */
  async function searchAt(
    lat: number,
    lon: number,
    originLabel: string,
    opts: { radiusM?: RadiusM; limit?: number } = {},
  ) {
    const radiusM = opts.radiusM ?? radius;
    const nextLimit = opts.limit ?? limit;
    setStatus("busy");
    setError("");
    try {
      const res = await fetch(
        `/api/shopping/nearby?lat=${lat}&lon=${lon}&radius=${radiusM}&limit=${nextLimit}`,
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { stores: NearbyStore[] };
      setStores(data.stores);
      setOrigin(originLabel);
      setOriginCoords({ lat, lon });
      setRadius(radiusM);
      setLimit(nextLimit);
      setHasMore(data.stores.length >= nextLimit);
      setStatus("ready");
      setResultsOpen(true);
    } catch {
      setStatus("error");
      setError("Couldn't load nearby stores. Try again.");
    }
  }

  /** Re-run the last search with a wider slice. No-op when we don't
   *  yet have an origin (the button is gated on `originCoords` too). */
  function loadMore() {
    if (!originCoords) return;
    void searchAt(originCoords.lat, originCoords.lon, origin, {
      limit: limit + LOAD_MORE_STEP,
    });
  }

  /** Re-run the last search at a different radius. Resets the slice
   *  back to the initial page since a fresh radius brings a fresh
   *  result ordering. */
  function changeRadius(next: RadiusM) {
    if (next === radius) return;
    if (!originCoords) {
      setRadius(next);
      return;
    }
    void searchAt(originCoords.lat, originCoords.lon, origin, {
      radiusM: next,
      limit: INITIAL_LIMIT,
    });
  }

  function useMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("error");
      setError("Location isn't available — enter an address instead.");
      return;
    }
    setStatus("busy");
    setError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void searchAt(
          pos.coords.latitude,
          pos.coords.longitude,
          "your location",
        );
      },
      (err) => {
        setStatus("error");
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location denied — enter an address instead."
            : "Couldn't get your location — enter an address instead.",
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  function pickSuggestion(s: GeocodeResult) {
    justPicked.current = true;
    setAddress(s.label);
    setSuggestions([]);
    void searchAt(s.lat, s.lon, s.label);
  }

  const busy = status === "busy";

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Stores near you
      </h4>

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 justify-center gap-1.5"
          onClick={useMyLocation}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MapPin className="h-3.5 w-3.5" />
          )}
          Use my location
        </Button>

        {/* Address autocomplete. Picking a suggestion runs the search;
            there's no free-text submit, so we only ever search a place
            the geocoder actually resolved. */}
        <div className="relative">
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="…or type an address / postcode"
            className="h-8 text-sm"
            aria-label="Address to search near"
            autoComplete="off"
          />
          {suggestions.length > 0 && (
            <ul className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-auto rounded-md border border-border/60 bg-popover py-1 shadow-lg">
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => pickSuggestion(s)}
                    className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {status === "error" && (
        <p className="text-xs text-muted-foreground">{error}</p>
      )}

      {/* Once a search has run, let the user reopen the results overlay
          without searching again. */}
      {status === "ready" && !resultsOpen && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 max-w-full px-1 text-xs text-muted-foreground"
          onClick={() => setResultsOpen(true)}
        >
          {stores.length > 0
            ? `Show ${stores.length} ${stores.length === 1 ? "store" : "stores"}`
            : "No stores found — search again"}
        </Button>
      )}

      <Dialog
        open={resultsOpen}
        onOpenChange={setResultsOpen}
      >
        {/* Bumped from sm:max-w-md to sm:max-w-2xl so the list has
            room to breathe on wide screens — the prior 28rem cap
            left a narrow column floating in a sea of empty viewport
            even on full-HD desktops. */}
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader className="text-left">
            <DialogTitle>Stores near you</DialogTitle>
            <DialogDescription className="truncate">
              {origin ? `Near ${origin}` : "Grocery stores nearby"}
            </DialogDescription>
          </DialogHeader>

          {/* Radius pills. Picking a value re-runs the search at
              the same origin with the new radius — switches between
              "walking distance" and "drive across town" without
              forcing the user to redo the address. */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border/40 pb-3">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Radius
            </span>
            {RADIUS_PRESETS_M.map((r) => {
              const active = r === radius;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => changeRadius(r)}
                  aria-pressed={active}
                  disabled={busy}
                  className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${
                    active
                      ? "border-foreground/40 bg-foreground text-background"
                      : "border-border/60 bg-background text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                  }`}
                >
                  {formatRadiusLabel(r)}
                </button>
              );
            })}
          </div>

          {stores.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No grocery stores found within {formatRadiusLabel(radius)}.
            </p>
          ) : (
            <>
              <ul className="-mx-1 divide-y divide-border/60">
                {stores.map((store) => (
                  <li
                    key={store.id}
                    className="flex items-center gap-3 px-1 py-2.5"
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
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDistance(store.distanceM)}
                        {store.address ? ` · ${store.address}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
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
                      aria-label={
                        favIds.has(store.id)
                          ? `Remove ${store.name} from favourites`
                          : `Save ${store.name} to favourites`
                      }
                      className="shrink-0 text-muted-foreground transition-colors hover:text-amber-500"
                    >
                      <Star
                        className={`h-4 w-4 ${
                          favIds.has(store.id)
                            ? "fill-amber-400 text-amber-400"
                            : ""
                        }`}
                      />
                    </button>
                    <a
                      href={storeDirectionsUrl(store, originCoords)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      <Navigation className="h-3 w-3" />
                      Directions
                    </a>
                  </li>
                ))}
              </ul>
              {hasMore && (
                <div className="flex justify-center border-t border-border/40 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={loadMore}
                    disabled={busy}
                    className="gap-1.5"
                  >
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
