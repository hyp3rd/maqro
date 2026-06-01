"use client";

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
  parseServingsCount,
  parseTotalTimeToMinutes,
} from "@/lib/recipe-import/text-utils";
import { useState } from "react";
import { Link2, Loader2, Sparkles } from "lucide-react";
import type { RecipeDraft } from "./RecipeForm";

type ParsedRecipeFromUrl = {
  name: string;
  ingredients: string[];
  instructions: string[];
  cuisine?: string;
  yieldText?: string;
  totalTime?: string;
  /** Only populated by the AI extraction path - captures author's
   *  tips, substitutions, storage notes, etc. JSON-LD never has
   *  this. */
  prepNotes?: string;
};

type ImportSource = "jsonld" | "ai";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired when the user chooses to "use" the parsed result. The
   *  draft has only `name`, `cuisine`, and `notes` populated -
   *  ingredients are NOT auto-matched against the food catalog
   *  (that would require AI resolution + OFF lookups). The user
   *  rebuilds ingredients in the regular form using the parsed
   *  text shown in `notes` as reference. */
  onDraft: (draft: RecipeDraft) => void;
  /** Fired when the API returns 402 - the user isn't on a paid
   *  tier and the parent should open the UpgradeDialog rather than
   *  leaving the import dialog stuck on a "premium required"
   *  message. We close this dialog as part of the signal so the
   *  upgrade prompt isn't competing for attention. */
  onPremiumRequired?: () => void;
  /** Fired when the API returns 401 - the cookie session expired
   *  mid-use. Parent should send the user to /login. */
  onSignInRequired?: () => void;
};

/** Paste-a-URL recipe importer. Hits /api/recipes/import-from-url,
 *  which fetches the page and parses any schema.org Recipe JSON-LD.
 *  Coverage is good across the major recipe sites; sites without
 *  the markup surface a clear "not supported" message.
 *
 *  The dialog has two states:
 *    - input: URL field + "Import" button
 *    - preview: parsed recipe summary + "Use it" / "Try another URL"
 *
 *  Using "Use it" pre-fills the regular RecipeForm with the parsed
 *  name + a notes block listing every original ingredient string
 *  and the source URL. The user then matches each ingredient
 *  against their food catalog (or OFF) by hand - the AI resolution
 *  pathway is a future improvement, not a blocker for this dialog
 *  shipping value. */
export function ImportRecipeDialog({
  open,
  onOpenChange,
  onDraft,
  onPremiumRequired,
  onSignInRequired,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent>
        {open && (
          <ImportRecipeBody
            onDraft={onDraft}
            onClose={() => onOpenChange(false)}
            onPremiumRequired={onPremiumRequired}
            onSignInRequired={onSignInRequired}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportRecipeBody({
  onDraft,
  onClose,
  onPremiumRequired,
  onSignInRequired,
}: {
  onDraft: Props["onDraft"];
  onClose: () => void;
  onPremiumRequired?: () => void;
  onSignInRequired?: () => void;
}) {
  const [url, setUrl] = useState("");
  const [parseWithAi, setParseWithAi] = useState(false);
  // Two-step opt-in for ingredient prefetch:
  //   1. checkbox in the input form (matchIngredients toggle)
  //   2. user reviews matches in the preview, then "Use this recipe"
  //      pipes the matched ingredient[] into the draft.
  // Off by default - the prefetch produces low-confidence matches
  // that a user may prefer to skip entirely in favor of building
  // ingredients from scratch with the catalog autocomplete.
  const [matchIngredients, setMatchIngredients] = useState(false);
  const [busy, setBusy] = useState(false);
  const [matchingBusy, setMatchingBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<{
    recipe: ParsedRecipeFromUrl;
    sourceUrl: string;
    source: ImportSource;
  } | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await clientFetch("/api/recipes/import-from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), parseWithAi }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        recipe?: ParsedRecipeFromUrl;
        sourceUrl?: string;
        source?: ImportSource;
        error?: string;
        kind?: string;
      };
      // 401 - cookie session expired mid-use (or, theoretically,
      // someone deep-linked the dialog while logged out). Hand off
      // to the parent so it can shoulder the redirect / login
      // surface; close this dialog so the prompts don't stack.
      if (res.status === 401) {
        onSignInRequired?.();
        onClose();
        return;
      }
      // 402 - authenticated but free tier. Same handoff pattern:
      // parent opens the real UpgradeDialog, this dialog closes so
      // it isn't competing with the upgrade prompt for attention.
      if (res.status === 402 && data.kind === "premium-required") {
        onPremiumRequired?.();
        onClose();
        return;
      }
      if (!res.ok || !data.ok || !data.recipe) {
        setError(data.error ?? "Couldn't import that URL.");
        return;
      }
      setParsed({
        recipe: data.recipe,
        sourceUrl: data.sourceUrl ?? url,
        source: data.source ?? "jsonld",
      });
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function applyDraft() {
    if (!parsed) return;
    const { recipe, sourceUrl } = parsed;

    let prefetchedIngredients: RecipeDraft["ingredients"] = [];
    let autoMatched = false;
    if (matchIngredients && recipe.ingredients.length > 0) {
      setMatchingBusy(true);
      try {
        const res = await clientFetch("/api/recipes/match-ingredients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingredients: recipe.ingredients }),
        });
        if (res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            results?: Array<{
              ingredient: RecipeDraft["ingredients"][number] | null;
            }>;
          };
          prefetchedIngredients = (data.results ?? [])
            .map((r) => r.ingredient)
            .filter((i): i is RecipeDraft["ingredients"][number] => i !== null);
          autoMatched = prefetchedIngredients.length > 0;
        }
        // Match failure is non-fatal - we just open the form with
        // empty ingredients (the existing behavior). The user can
        // still build manually using the notes as reference.
      } finally {
        setMatchingBusy(false);
      }
    }

    onDraft({
      name: recipe.name.slice(0, 80),
      ingredients: prefetchedIngredients,
      cuisine: recipe.cuisine,
      // Structured fields - promoted out of notes in migration 0039
      // so the recipe surface can render them as proper metadata
      // (badges, scaling control) rather than as wall-of-text in
      // notes. Source URL passes through the same https:// gate the
      // import fetch already used.
      sourceUrl: sourceUrl.startsWith("https://") ? sourceUrl : undefined,
      servings: parseServingsCount(recipe.yieldText),
      prepTimeMinutes: parseTotalTimeToMinutes(recipe.totalTime),
      notes: buildNotes({ recipe }),
      // RecipeForm reads this flag to decide whether to surface
      // the "auto-matched - verify before saving" banner. Not
      // persisted to the DB; lives only on the draft object.
      autoMatched,
    });
    // Intentionally NOT calling onClose() - we leave this preview
    // dialog mounted underneath the RecipeForm that opens via
    // onDraft. When the user clicks "← Back to preview" in the
    // form (or closes it any other way), they're returned to this
    // preview where they can re-import, try another URL, or close
    // for good. Without this, "Use this recipe" was a one-way door
    // - the user had no way to re-check the ingredient list while
    // filling out the form.
  }

  if (parsed) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            Preview imported recipe
            {parsed.source === "ai" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-inset ring-violet-500/20 dark:text-violet-300">
                <Sparkles className="h-3 w-3" />
                AI
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            Instructions and tips get folded into the recipe&apos;s notes so you
            have them as reference while you rebuild the ingredients.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Name
            </div>
            <div className="font-medium">{parsed.recipe.name}</div>
          </div>
          {(parsed.recipe.cuisine ||
            parsed.recipe.yieldText ||
            parsed.recipe.totalTime) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
              {parsed.recipe.cuisine && (
                <span>
                  <span className="font-medium text-foreground">
                    {parsed.recipe.cuisine}
                  </span>{" "}
                  cuisine
                </span>
              )}
              {parsed.recipe.yieldText && (
                <span>{parsed.recipe.yieldText}</span>
              )}
              {parsed.recipe.totalTime && (
                <span>{parsed.recipe.totalTime}</span>
              )}
            </div>
          )}
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Ingredients ({parsed.recipe.ingredients.length})
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] marker:text-muted-foreground/60">
              {parsed.recipe.ingredients.map((ing, i) => (
                <li key={i}>{ing}</li>
              ))}
            </ul>
          </div>
          {parsed.recipe.instructions.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Instructions ({parsed.recipe.instructions.length})
              </div>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-[13px] marker:text-muted-foreground/60">
                {parsed.recipe.instructions.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>
          )}
          {parsed.recipe.prepNotes && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Notes &amp; tips
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[13px] text-foreground/85">
                {parsed.recipe.prepNotes}
              </p>
            </div>
          )}
        </div>
        <label className="flex items-start gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-[12px] leading-relaxed text-foreground/85">
          <input
            type="checkbox"
            checked={matchIngredients}
            onChange={(e) => setMatchIngredients(e.target.checked)}
            disabled={matchingBusy}
            className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-amber-500"
          />
          <span>
            <span className="font-medium">Try to match ingredients</span> -
            best-effort lookup against the built-in food catalog. Volumetric
            measures get rough gram conversions. Verify before saving.
          </span>
        </label>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            disabled={matchingBusy}
            onClick={() => {
              setParsed(null);
              setUrl("");
              setMatchIngredients(false);
            }}
          >
            Try another URL
          </Button>
          <Button
            onClick={() => void applyDraft()}
            disabled={matchingBusy}
          >
            {matchingBusy ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Matching…
              </>
            ) : matchIngredients ? (
              "Use this recipe with matches"
            ) : (
              "Use as draft"
            )}
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          Import recipe from URL
        </DialogTitle>
        <DialogDescription>
          Paste a recipe URL. Works on most major recipe sites - anything with
          schema.org Recipe markup.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-3"
      >
        <div className="space-y-1.5">
          <Label
            htmlFor="import-url"
            className="text-xs font-medium text-muted-foreground"
          >
            Recipe URL
          </Label>
          <Input
            id="import-url"
            type="url"
            required
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://cooking.nytimes.com/recipes/…"
            disabled={busy}
          />
        </div>
        <label className="flex items-start gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-[12px] leading-relaxed text-foreground/85">
          <input
            type="checkbox"
            checked={parseWithAi}
            onChange={(e) => setParseWithAi(e.target.checked)}
            disabled={busy}
            className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-violet-500"
          />
          <span>
            <span className="font-medium">Parse with AI</span> - works on sites
            without schema.org markup and pulls out prep notes / tips JSON-LD
            usually omits. Counts toward your monthly AI usage.
          </span>
        </label>
        {error && (
          <p
            role="alert"
            className="text-xs text-red-600"
          >
            {error}
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={busy || url.trim().length === 0}
          >
            {busy ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Importing…
              </>
            ) : (
              "Import"
            )}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

/** Build the recipe-form `notes` field from the parsed import data.
 *  Source URL, servings, and prep time were promoted to structured
 *  fields in migration 0039 - they no longer live here. Notes is
 *  now reserved for the high-information-density content that has
 *  no structured home: prep tips, the ingredient reference list
 *  (because we don't auto-populate ingredient rows), and the full
 *  numbered step list.
 *
 *  Priority order under the 3000-char cap that RecipeForm enforces:
 *    1. AI's prepNotes when present (highest-signal author content)
 *    2. Ingredients (always - the user needs them to rebuild the
 *       recipe's macros row by row, no structured slot lets us
 *       pre-fill them without inventing macro values)
 *    3. Instructions (full step list as numbered reference)
 *
 *  Each section is added incrementally; if adding one would push us
 *  past the cap, we either truncate the section with an ellipsis
 *  or drop it entirely (whichever leaves the field readable). */
function buildNotes(opts: { recipe: ParsedRecipeFromUrl }): string {
  const CAP = 3000;
  const { recipe } = opts;
  const sections: string[] = [];

  if (recipe.prepNotes) {
    sections.push(`Notes: ${recipe.prepNotes}`);
  }

  if (recipe.ingredients.length > 0) {
    sections.push(
      `Ingredients (${recipe.ingredients.length}):\n` +
        recipe.ingredients.map((i) => `• ${i}`).join("\n"),
    );
  }

  if (recipe.instructions.length > 0) {
    sections.push(
      "Steps:\n" +
        recipe.instructions.map((s, i) => `${i + 1}. ${s}`).join("\n"),
    );
  }

  // Try assembling in priority order; drop trailing sections that
  // would push past the cap. Truncate the last surviving section
  // with an ellipsis rather than cutting mid-word at the boundary.
  let out = "";
  for (const section of sections) {
    const candidate = out.length === 0 ? section : `${out}\n\n${section}`;
    if (candidate.length <= CAP) {
      out = candidate;
      continue;
    }
    const remaining = CAP - out.length - 2 - 1; // \n\n + ellipsis
    if (remaining > 20) {
      out = `${out}\n\n${section.slice(0, remaining)}…`;
    }
    break;
  }
  return out;
}
