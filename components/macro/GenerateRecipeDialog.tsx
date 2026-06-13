"use client";

import type { PersonalInfo } from "@/components/macro/types";
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
import { Label } from "@/components/ui/label";
import { clientFetch } from "@/lib/auth/client-fetch";
import {
  listCustomFoods,
  listDailyLogs,
  listPantryItems,
  todayKey,
} from "@/lib/db";
import { extractFoodPreferences } from "@/lib/personalization/preferences";
import { useState } from "react";
import { Loader2, LogIn, Sparkles } from "lucide-react";
import type { RecipeDraft } from "./RecipeForm";
import { UpgradeDialog } from "./UpgradeDialog";

const HINT_MAX = 200;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: PersonalInfo;
  /** Fired with the AI's draft on success. The parent should open
   *  RecipeForm pre-filled with this draft so the user reviews + saves. */
  onDraft: (draft: RecipeDraft) => void;
};

/** Error + which gate (if any) it represents — `auth`/`cap` render a
 *  proper CTA (sign-in / upgrade) instead of bare text. */
type GenerateError = { message: string; gate?: "auth" | "cap" };

export function GenerateRecipeDialog({
  open,
  onOpenChange,
  profile,
  onDraft,
}: Props) {
  // Outer dialog only - the body mounts on open so state initializes
  // afresh each time without a setState-in-effect reset.
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent>
        {open && (
          <GenerateRecipeDialogBody
            profile={profile}
            onDraft={onDraft}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function GenerateRecipeDialogBody({
  profile,
  onDraft,
  onClose,
}: {
  profile: Props["profile"];
  onDraft: Props["onDraft"];
  onClose: () => void;
}) {
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GenerateError | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    try {
      // Load custom foods at generate time so the AI sees the latest list
      // without the parent having to plumb them through.
      const customs = await listCustomFoods().catch(() => []);

      // Personalization signal: top foods from the user's recent
      // daily-log history. The AI bakes them into the system prompt
      // as a soft bias — generated recipes lean on what the user
      // actually eats instead of always pulling from the seed
      // catalog's stock picks. Failure-tolerant: an IDB hiccup just
      // means no bias on this call, NEVER blocks generation.
      let recentlyEatenFoods: { name: string; count: number }[] = [];
      try {
        const logs = await listDailyLogs();
        recentlyEatenFoods = extractFoodPreferences(logs, {
          todayKey: todayKey(),
        });
      } catch {
        // Proceed with no bias — the AI still produces a recipe.
      }

      // Pantry-on-hand bias: prefer a recipe that uses what the user
      // already has. Same failure-tolerance as the rotation signal.
      let pantryItems: { name: string; quantity: number; unit: string }[] = [];
      try {
        const rows = await listPantryItems();
        pantryItems = rows.map((p) => ({
          name: p.name,
          quantity: p.quantity,
          unit: p.unit,
        }));
      } catch {
        // Proceed with no pantry bias.
      }

      const res = await clientFetch("/api/recipes/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dietPreference: profile.dietPreference,
          cuisinePreferences: profile.cuisinePreferences,
          allergies: profile.allergies,
          dislikedFoods: profile.dislikedFoods,
          // The route expects Food shape - map CustomFood by copying the
          // fields it uses. id is dropped server-side so we don't bother.
          customFoods: customs.map((c) => ({
            name: c.name,
            protein: c.protein,
            carbs: c.carbs,
            fat: c.fat,
            calories: c.calories,
            category: c.category,
            subCategory: c.subCategory,
            brand: c.brand,
            dietKind: c.dietKind,
          })),
          hint: hint.trim() || undefined,
          recentlyEatenFoods,
          pantryItems,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          used?: number;
          cap?: number;
        };
        if (res.status === 401) {
          setError({
            message: "AI recipe generation needs an account.",
            gate: "auth",
          });
        } else if (res.status === 402) {
          setError({
            message:
              typeof data.used === "number" && typeof data.cap === "number"
                ? `You've used all your AI generations this month (${data.used}/${data.cap}). Resets on the 1st.`
                : "You've reached your monthly AI limit. Resets on the 1st.",
            gate: "cap",
          });
        } else {
          setError({
            message:
              res.status === 503
                ? "AI recipe suggestions aren't available on this instance."
                : res.status === 429
                  ? "AI is rate-limited. Try again shortly."
                  : (data.error ?? "AI request failed."),
          });
        }
        return;
      }

      const data = (await res.json()) as { recipe?: RecipeDraft };
      if (!data.recipe) throw new Error("AI returned no recipe.");
      onDraft(data.recipe);
      onClose();
    } catch (err) {
      setError({
        message: err instanceof Error ? err.message : "AI request failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Generate recipe
        </DialogTitle>
        <DialogDescription>
          The AI proposes one recipe based on your diet, cuisine, and allergy
          settings. You&apos;ll review it before saving.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2 py-2">
        <Label
          htmlFor="recipe-hint"
          className="text-xs font-medium"
        >
          Hint (optional)
          <span className="ml-2 text-[10px] text-muted-foreground">
            {hint.length}/{HINT_MAX}
          </span>
        </Label>
        <Input
          id="recipe-hint"
          value={hint}
          onChange={(e) => setHint(e.target.value.slice(0, HINT_MAX))}
          placeholder="e.g. something Korean and light"
          disabled={busy}
        />

        {error && (
          <div className="space-y-2">
            <p
              role="alert"
              className="text-xs text-destructive"
            >
              {error.message}
            </p>
            {error.gate === "auth" && (
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                onClick={() =>
                  window.location.assign(
                    `/login?next=${encodeURIComponent("/app?view=recipes")}`,
                  )
                }
              >
                <LogIn className="h-3.5 w-3.5" />
                Sign in
              </Button>
            )}
            {error.gate === "cap" && (
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                onClick={() => setUpgradeOpen(true)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Upgrade
              </Button>
            )}
          </div>
        )}
      </div>

      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        reason="ai-cap"
        defaultPlan="plus"
      />

      <DialogFooter className="gap-2 sm:gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleGenerate}
          disabled={busy}
        >
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Generate
            </>
          )}
        </Button>
      </DialogFooter>
    </>
  );
}
