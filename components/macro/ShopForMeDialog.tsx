"use client";

import type {
  ShoppingSuggestion,
  ShoppingSuggestionItem,
} from "@/app/api/shopping/suggest/route";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { clientFetch } from "@/lib/auth/client-fetch";
import type { PantryItem } from "@/lib/db";
import { SHOPPING_AISLES, categorizeFallback } from "@/lib/shopping/categorize";
import { pantryGapItems } from "@/lib/shopping/gaps";
import {
  SHOPPING_PROVIDERS,
  providerSearchUrl,
} from "@/lib/shopping/providers";
import { useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  ShoppingCart,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { FavoriteStores } from "./FavoriteStores";
import { NearbyStores } from "./NearbyStores";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pantryItems: PantryItem[];
  /** When set on open, this item is prepended to the seeds and
   *  pre-selected, even if it isn't currently a "gap". Drives the
   *  per-row "Restock" shortcut in the pantry. */
  extraSeedItemId?: string;
};

type SeedItem = {
  name: string;
  quantity: number;
  unit: string;
  selected: boolean;
};

/** "Shop for me": seeds from the pantry's low/empty items, asks the AI
 *  (or a deterministic fallback) to turn them into a clean, aisle-grouped
 *  shopping list, then hands off to Instacart (real pre-filled cart) or a
 *  search on Uber Eats / DoorDash / Glovo. No checkout here — the user
 *  finishes on the provider. */
export function ShopForMeDialog({
  open,
  onOpenChange,
  pantryItems,
  extraSeedItemId,
}: Props) {
  const [seeds, setSeeds] = useState<SeedItem[]>([]);
  const [adhoc, setAdhoc] = useState("");
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<ShoppingSuggestion | null>(null);

  const [instacartUnavailable, setInstacartUnavailable] = useState(false);
  const [instacartLoading, setInstacartLoading] = useState(false);

  // Re-seed from the current pantry gaps each time the dialog opens.
  // Done as a during-render reset on the open↔closed transition (the
  // React-recommended "adjust state when a prop changes" pattern) rather
  // than a setState-in-effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const gapSeeds = pantryGapItems(pantryItems).map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        selected: true,
      }));
      // The "Restock" row-shortcut: prepend the requested item if it's
      // not already in the gap-derived seeds, and ensure it's selected.
      const extra = extraSeedItemId
        ? pantryItems.find((p) => p.id === extraSeedItemId)
        : undefined;
      const finalSeeds =
        extra && !gapSeeds.some((s) => s.name === extra.name)
          ? [
              {
                name: extra.name,
                quantity: extra.quantity,
                unit: extra.unit,
                selected: true,
              },
              ...gapSeeds,
            ]
          : gapSeeds;
      setSeeds(finalSeeds);
      setResult(null);
      setAdhoc("");
      setInstacartUnavailable(false);
    }
  }

  const selected = seeds.filter((s) => s.selected);

  function toggle(index: number) {
    setSeeds((prev) =>
      prev.map((s, i) => (i === index ? { ...s, selected: !s.selected } : s)),
    );
  }

  function addAdhoc() {
    const name = adhoc.trim();
    if (!name) return;
    setSeeds((prev) =>
      prev.some((s) => s.name.toLowerCase() === name.toLowerCase())
        ? prev
        : [...prev, { name, quantity: 1, unit: "unit", selected: true }],
    );
    setAdhoc("");
  }

  /** Deterministic list when the route is unavailable (guest / offline /
   *  error) — mirrors the server fallback so the feature always works. */
  function localFallback(): ShoppingSuggestion {
    const byName = new Map<string, ShoppingSuggestionItem>();
    for (const s of selected) {
      const key = s.name.toLowerCase();
      if (byName.has(key)) continue;
      byName.set(key, {
        name: s.name,
        quantity: s.quantity > 0 ? s.quantity : 1,
        unit: s.unit || "unit",
        category: categorizeFallback(s.name),
      });
    }
    return { items: [...byName.values()], ai: false };
  }

  async function build() {
    if (selected.length === 0) return;
    setBuilding(true);
    try {
      const res = await clientFetch("/api/shopping/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: selected.map((s) => ({
            name: s.name,
            quantity: s.quantity,
            unit: s.unit,
          })),
        }),
      });
      if (res.ok) {
        setResult((await res.json()) as ShoppingSuggestion);
      } else {
        setResult(localFallback());
      }
    } catch {
      setResult(localFallback());
    } finally {
      setBuilding(false);
    }
  }

  const grouped = useMemo(() => {
    if (!result) return [];
    return SHOPPING_AISLES.map((aisle) => ({
      aisle,
      items: result.items.filter((i) => i.category === aisle),
    })).filter((g) => g.items.length > 0);
  }, [result]);

  function removeResultItem(name: string) {
    setResult((prev) =>
      prev
        ? { ...prev, items: prev.items.filter((i) => i.name !== name) }
        : prev,
    );
  }

  function listAsText(): string {
    if (!result) return "";
    return grouped
      .map(
        (g) =>
          `${g.aisle}\n${g.items
            .map((i) => `  - ${i.name} (${i.quantity} ${i.unit})`)
            .join("\n")}`,
      )
      .join("\n\n");
  }

  async function copyList() {
    try {
      await navigator.clipboard.writeText(listAsText());
      toast.success("Shopping list copied");
    } catch {
      toast.error("Couldn't copy the list");
    }
  }

  async function openInstacart() {
    if (!result || result.items.length === 0) return;
    setInstacartLoading(true);
    try {
      const res = await clientFetch("/api/shopping/instacart-cart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Maqro restock",
          items: result.items.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            unit: i.unit,
          })),
        }),
      });
      if (res.status === 503) {
        setInstacartUnavailable(true);
        toast.error("Instacart isn't set up on this deployment.");
        return;
      }
      if (!res.ok) {
        toast.error("Couldn't build the Instacart cart. Try again.");
        return;
      }
      const { url } = (await res.json()) as { url: string };
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Couldn't reach Instacart.");
    } finally {
      setInstacartLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border/60 px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4" />
            Shop for me
          </DialogTitle>
          <DialogDescription>
            {result
              ? "Your restock list — order it or copy it."
              : "Pick what to restock; we'll build a clean shopping list."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!result ? (
            <SeedPicker
              seeds={seeds}
              adhoc={adhoc}
              setAdhoc={setAdhoc}
              onToggle={toggle}
              onAddAdhoc={addAdhoc}
            />
          ) : (
            <ResultList
              grouped={grouped}
              ai={result.ai}
              onRemove={removeResultItem}
            />
          )}

          <div className="mt-4 space-y-4 border-t border-border/60 pt-4">
            <NearbyStores />
            <FavoriteStores />
          </div>
        </div>

        <DialogFooter className="border-t border-border/60 px-5 py-3">
          {!result ? (
            <Button
              type="button"
              onClick={build}
              disabled={building || selected.length === 0}
              className="gap-1.5"
            >
              {building ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Build my list ({selected.length})
            </Button>
          ) : (
            // Mobile: stack so each control is a clear, full-width tap
            // target (the old ghost "Back" centered on its own wrapped
            // row read as a heading, not a button). Desktop: one row,
            // Back on the left, actions on the right.
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setResult(null)}
                className="justify-center gap-1.5 sm:justify-start"
              >
                <ChevronLeft className="h-4 w-4" />
                Back to picks
              </Button>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyList}
                  className="gap-1.5"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
                {!instacartUnavailable && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={openInstacart}
                    disabled={instacartLoading || result.items.length === 0}
                    className="gap-1.5"
                  >
                    {instacartLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShoppingCart className="h-3.5 w-3.5" />
                    )}
                    Open in Instacart
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SeedPicker({
  seeds,
  adhoc,
  setAdhoc,
  onToggle,
  onAddAdhoc,
}: {
  seeds: SeedItem[];
  adhoc: string;
  setAdhoc: (v: string) => void;
  onToggle: (index: number) => void;
  onAddAdhoc: () => void;
}) {
  return (
    <div className="space-y-3">
      {seeds.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing's running low right now. Add anything you want to buy below.
        </p>
      ) : (
        <ul className="space-y-1">
          {seeds.map((s, i) => (
            <li key={`${s.name}-${i}`}>
              <button
                type="button"
                onClick={() => onToggle(i)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    s.selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input"
                  }`}
                >
                  {s.selected && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {s.quantity} {s.unit} left
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Input
          value={adhoc}
          onChange={(e) => setAdhoc(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAddAdhoc();
            }
          }}
          placeholder="Add something else…"
          className="h-8 text-sm"
          aria-label="Add an item to the shopping list"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={onAddAdhoc}
          aria-label="Add item"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ResultList({
  grouped,
  ai,
  onRemove,
}: {
  grouped: { aisle: string; items: ShoppingSuggestionItem[] }[];
  ai: boolean;
  onRemove: (name: string) => void;
}) {
  if (grouped.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Your list is empty. Go back to add items.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {!ai && (
        <p className="text-xs text-muted-foreground">
          Built a quick list (AI assist unavailable). You can still order or
          copy it.
        </p>
      )}
      {grouped.map((g) => (
        <div key={g.aisle}>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {g.aisle}
          </h4>
          <ul className="space-y-1">
            {g.items.map((item) => (
              <li
                key={item.name}
                className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate font-medium">{item.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {item.quantity} {item.unit}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    {SHOPPING_PROVIDERS.map((p) => (
                      <a
                        key={p.id}
                        href={providerSearchUrl(p.id, item.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-0.5 text-[11px] ${p.accentClass} hover:underline`}
                      >
                        {p.label}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ))}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground"
                  onClick={() => onRemove(item.name)}
                  aria-label={`Remove ${item.name}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
