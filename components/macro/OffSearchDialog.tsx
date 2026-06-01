"use client";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useFoodSearch } from "@/hooks/use-food-search";
import { useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import type { Food } from "./types";

/** Dialog that lets the user search Open Food Facts when adding a
 *  food to My Foods. Pure picker — the chosen Food is handed back
 *  via `onPick` and the caller is expected to open the preview-and-
 *  save dialog (which then writes to IDB). Keeps the side-effects out
 *  of this component so the search list stays presentational.
 *
 *  Result filtering: `useFoodSearch` returns mixed sources (builtin +
 *  custom + OFF). In this dialog we only show OFF results — built-in
 *  foods are already available to the meal planner without being
 *  saved, and custom foods are obviously already in the user's My
 *  Foods. Showing them would just be noise. */
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires when the user picks an OFF result. The caller opens the
   *  preview-and-save dialog with this food. */
  onPick: (food: Food) => void;
};

export function OffSearchDialog({ open, onOpenChange, onPick }: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent>
        {open && (
          <SearchBody
            onPick={(food) => {
              onOpenChange(false);
              onPick(food);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SearchBody({ onPick }: { onPick: (food: Food) => void }) {
  const [query, setQuery] = useState("");
  const { results, isSearchingRemote } = useFoodSearch(query);
  const offResults = useMemo(
    () => results.filter((r) => r.source === "off"),
    [results],
  );
  const trimmed = query.trim();

  return (
    <>
      <DialogHeader>
        <DialogTitle>Search Open Food Facts</DialogTitle>
        <DialogDescription>
          Find a packaged food in the public Open Food Facts database. Pick a
          result to preview its full macros breakdown before saving to your My
          Foods.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. 'oat milk', 'protein bar', 'kimchi'…"
            className="pl-9 pr-9"
            autoFocus
          />
          {isSearchingRemote && (
            <Loader2
              aria-label="Searching Open Food Facts"
              className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
            />
          )}
        </div>

        {!trimmed ? (
          <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
            Start typing to search. Results come from the public Open Food Facts
            database — quality varies by product, so always cross-check the
            label before saving.
          </p>
        ) : offResults.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
            {isSearchingRemote
              ? "Searching…"
              : "No matches. Try a more specific term or check the brand spelling."}
          </p>
        ) : (
          <ul className="max-h-72 divide-y divide-border/60 overflow-auto rounded-md border border-border/60 bg-card">
            {offResults.map((food) => (
              <li key={food.id ?? food.name}>
                <button
                  type="button"
                  onClick={() => onPick(food)}
                  className="block w-full px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:bg-accent"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {food.name}
                    </span>
                    {food.brand && (
                      <Badge
                        variant="secondary"
                        className="shrink-0 text-[10px] font-normal"
                      >
                        {food.brand}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {Math.round(food.calories)} kcal · P
                    {food.protein.toFixed(1)}g · C{food.carbs.toFixed(1)}g · F
                    {food.fat.toFixed(1)}g
                    <span className="ml-1 text-muted-foreground/60">
                      / 100g
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
