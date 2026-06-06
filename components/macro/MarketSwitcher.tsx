"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  clearMarketOverride,
  setMarket,
  useDefaultMarket,
  useMarket,
  useMarketOverride,
} from "@/lib/market";
import { MARKETS } from "@/lib/markets";
import { Check, ChevronDown } from "lucide-react";

/** Shopping-market picker for the food-search header. Biases Open Food Facts
 *  results toward the chosen country (the bias lives server-side in
 *  `lib/ai/off-search.ts`).
 *
 *  Two tiers: "Automatic" defers to the synced home market (set in Settings) or
 *  the browser region; picking a country sets a per-device override that wins
 *  locally — switchable on the go. Modelled on `components/shell/LocaleSwitcher`. */
export function MarketSwitcher() {
  const current = useMarket();
  const override = useMarketOverride();
  const fallback = useDefaultMarket();
  const active = MARKETS.find((m) => m.code === current) ?? MARKETS[0];
  const fallbackInfo = MARKETS.find((m) => m.code === fallback) ?? MARKETS[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Shopping market: ${active.name}`}
        className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-foreground"
      >
        <span
          aria-hidden
          className="text-base leading-none"
        >
          {active.flag}
        </span>
        <span className="font-medium">
          {active.code === "world" ? "World" : active.code}
        </span>
        <ChevronDown
          className="h-3 w-3 opacity-70"
          aria-hidden
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-[60vh] min-w-[12rem] overflow-y-auto"
      >
        {/* Tier 1 — defer to the synced home market / browser region. */}
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            clearMarketOverride();
          }}
          className="flex items-center justify-between gap-3 px-2"
        >
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="text-base leading-none"
            >
              {fallbackInfo.flag}
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-medium leading-tight">
                Automatic
              </span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {fallbackInfo.code === "world"
                  ? "Worldwide"
                  : `Home or region · ${fallbackInfo.name}`}
              </span>
            </span>
          </span>
          {override === null && (
            <Check
              className="h-3.5 w-3.5 text-foreground"
              aria-hidden
            />
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Tier 2 — a per-device override that wins locally. */}
        {MARKETS.map((m) => {
          const isActive = override === m.code;
          return (
            <DropdownMenuItem
              key={m.code}
              onSelect={(e) => {
                e.preventDefault();
                setMarket(m.code);
              }}
              className="flex items-center justify-between gap-3 px-2"
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="text-base leading-none"
                >
                  {m.flag}
                </span>
                <span className="text-sm font-medium leading-tight">
                  {m.name}
                </span>
              </span>
              {isActive && (
                <Check
                  className="h-3.5 w-3.5 text-foreground"
                  aria-hidden
                />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
