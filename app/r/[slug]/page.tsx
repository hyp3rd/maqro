import type { RecipeIngredient } from "@/components/macro/types";
import { getEffectiveUser } from "@/lib/auth/effective-user";
import { isValidShareSlug } from "@/lib/share-slug";
import { getSupabaseServer } from "@/lib/supabase/server";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { RecipePageActions } from "./RecipePageActions";

/** Public recipe view at `/r/<slug>`. Visibility is enforced by the
 *  RLS policies in migration 0010:
 *
 *    - `'public'`   - anon + authenticated can read
 *    - `'members'`  - authenticated only; anon hits the read window
 *                     and gets nothing back
 *    - `'disabled'` - only the owner can read (via owner-all policy)
 *
 *  This page does a single bound-by-current-session SELECT. If the row
 *  comes back, we render. If it doesn't, we render a friendly "not
 *  available" panel with a Sign-in CTA - that recovers the
 *  members-only-viewed-by-anon case (signing in unlocks the read) and
 *  reads as a generic 404 for the truly-not-found / disabled cases.
 *  Signed-in visitors get the import CTA via [RecipePageActions.tsx]
 *  (./RecipePageActions.tsx). */

type SharedRecipe = {
  name: string;
  ingredients: RecipeIngredient[];
  cuisine: string | null;
  notes: string | null;
};

async function fetchShared(slug: string): Promise<SharedRecipe | null> {
  if (!isValidShareSlug(slug)) return null;
  const supabase = await getSupabaseServer();
  if (!supabase) return null;
  const { data } = await supabase
    .from("recipes")
    .select("name, ingredients, cuisine, notes")
    .eq("share_slug", slug)
    .maybeSingle();
  return (data as SharedRecipe) ?? null;
}

async function currentUserId(): Promise<string | null> {
  // Routed through `getEffectiveUser` so AAL1+TOTP-pending users
  // count as anonymous here — they see the "sign in to view" CTA
  // on private recipes like any other signed-out visitor. The
  // recipe page itself never depends on identity for security
  // (visibility is enforced in Postgres via RLS on the public
  // share view); the `signedIn` flag is purely about which
  // copy/CTA to show.
  const { user } = await getEffectiveUser();
  return user?.id ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const recipe = await fetchShared(slug);
  if (!recipe) {
    return {
      title: "Recipe not found",
      // Don't index a not-found / permission-denied page - keeps
      // dead share links out of Google.
      robots: { index: false, follow: false },
    };
  }

  // Macro summary tucked into the description so iMessage / Slack /
  // Discord previews show useful numbers, not just a name. Kept
  // short - most platforms truncate around 150 chars.
  const totals = recipe.ingredients.reduce(
    (acc, ing) => {
      const r = ing.portionGrams / 100;
      return {
        p: acc.p + ing.macrosPer100g.protein * r,
        c: acc.c + ing.macrosPer100g.carbs * r,
        f: acc.f + ing.macrosPer100g.fat * r,
        k: acc.k + ing.macrosPer100g.calories * r,
      };
    },
    { p: 0, c: 0, f: 0, k: 0 },
  );
  const macros = `${Math.round(totals.k)} kcal · P ${Math.round(totals.p)} g · C ${Math.round(totals.c)} g · F ${Math.round(totals.f)} g`;
  const cuisine = recipe.cuisine ? ` (${recipe.cuisine})` : "";
  const description = `${recipe.ingredients.length} ingredients${cuisine} - ${macros}.`;

  const url = `/r/${slug}`;
  return {
    title: recipe.name,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: recipe.name,
      description,
      url,
      siteName: "Maqro",
    },
    twitter: { card: "summary", title: recipe.name, description },
  };
}

export default async function PublicRecipePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const recipe = await fetchShared(slug);
  if (!recipe) {
    const userId = await currentUserId();
    return (
      <UnavailablePanel
        slug={slug}
        signedIn={userId !== null}
      />
    );
  }

  const totals = recipe.ingredients.reduce(
    (acc, ing) => {
      const ratio = ing.portionGrams / 100;
      return {
        protein: acc.protein + ing.macrosPer100g.protein * ratio,
        carbs: acc.carbs + ing.macrosPer100g.carbs * ratio,
        fat: acc.fat + ing.macrosPer100g.fat * ratio,
        calories: acc.calories + ing.macrosPer100g.calories * ratio,
      };
    },
    { protein: 0, carbs: 0, fat: 0, calories: 0 },
  );
  const totalGrams = recipe.ingredients.reduce(
    (a, ing) => a + ing.portionGrams,
    0,
  );

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-6 py-10 print:py-4">
      {/* Topbar - hidden on print. */}
      <div className="flex items-center justify-between print:hidden">
        <Link
          href="/app"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to app
        </Link>
        <RecipePageActions slug={slug} />
      </div>

      <header className="mt-6 print:mt-0">
        <h1 className="text-3xl font-semibold tracking-tight">{recipe.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {recipe.cuisine && (
            <span className="rounded bg-muted px-2 py-0.5 font-medium text-foreground">
              {recipe.cuisine}
            </span>
          )}
          <span>
            {recipe.ingredients.length} ingredient
            {recipe.ingredients.length === 1 ? "" : "s"}
          </span>
          {totalGrams > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>{Math.round(totalGrams)} g total</span>
            </>
          )}
        </div>
      </header>

      <section className="mt-6 rounded-lg border border-border/60 bg-card p-4 print:border-foreground/30">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Macros (full recipe)
        </h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 font-mono tabular-nums sm:grid-cols-4">
          <MacroCell
            label="Calories"
            value={`${Math.round(totals.calories)} kcal`}
          />
          <MacroCell
            label="Protein"
            value={`${totals.protein.toFixed(1)} g`}
            cssVar="--macro-protein"
          />
          <MacroCell
            label="Carbs"
            value={`${totals.carbs.toFixed(1)} g`}
            cssVar="--macro-carbs"
          />
          <MacroCell
            label="Fat"
            value={`${totals.fat.toFixed(1)} g`}
            cssVar="--macro-fat"
          />
        </dl>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold tracking-tight">
          Ingredients
        </h2>
        <ul className="divide-y divide-border/60 rounded-md border border-border/60 bg-card print:border-foreground/30">
          {recipe.ingredients.map((ing, idx) => {
            const ratio = ing.portionGrams / 100;
            return (
              <li
                key={`${ing.foodName}-${idx}`}
                className="flex items-baseline gap-3 px-4 py-3"
              >
                <span className="min-w-0 flex-1 text-sm font-medium">
                  {ing.foodName}
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {ing.portionGrams} g
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {Math.round(ing.macrosPer100g.calories * ratio)} kcal · P
                  {(ing.macrosPer100g.protein * ratio).toFixed(1)} · C
                  {(ing.macrosPer100g.carbs * ratio).toFixed(1)} · F
                  {(ing.macrosPer100g.fat * ratio).toFixed(1)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {recipe.notes && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold tracking-tight">Notes</h2>
          <p className="whitespace-pre-line rounded-md border border-border/60 bg-card px-4 py-3 text-sm leading-relaxed text-foreground print:border-foreground/30">
            {recipe.notes}
          </p>
        </section>
      )}

      <footer className="mt-10 border-t border-border/60 pt-4 text-[11px] text-muted-foreground print:mt-6 print:border-foreground/30">
        Shared via{" "}
        <Link
          href="/"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Maqro
        </Link>
        . Macros are estimates - verify against actual product labels.
      </footer>
    </div>
  );
}

/** Catch-all "you can't see this" panel. Same UI for three reasons:
 *
 *   - The slug doesn't exist (typo, never minted).
 *   - The owner revoked or disabled the share.
 *   - The share is members-only and the visitor isn't signed in.
 *
 *  We don't disambiguate to avoid leaking that a slug *exists* but is
 *  hidden - that's information one OFF visit could have inferred but
 *  the page should remain neutral. The sign-in CTA gives the
 *  members-only case a viable path forward (after sign-in, the same
 *  URL renders normally) without telling anyone it's the cause.
 *  Signed-in visitors don't see the CTA - for them, the answer is
 *  definitely "this link doesn't work for you." */
function UnavailablePanel({
  slug,
  signedIn,
}: {
  slug: string;
  signedIn: boolean;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-10 text-center">
      <LockKeyhole className="h-10 w-10 text-muted-foreground/60" />
      <h1 className="mt-4 text-lg font-semibold tracking-tight">
        Recipe not available
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The link may have been revoked or disabled by the owner
        {signedIn ? "." : ", or it may be visible to signed-in users only."}
      </p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        {!signedIn && (
          <Link
            href={`/login?next=${encodeURIComponent(`/r/${slug}`)}`}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Sign in
          </Link>
        )}
        <Link
          href="/"
          className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-accent"
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back to app
        </Link>
      </div>
    </div>
  );
}

function MacroCell({
  label,
  value,
  cssVar,
}: {
  label: string;
  value: string;
  cssVar?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className="text-lg font-semibold text-foreground"
        style={cssVar ? { color: `hsl(var(${cssVar}))` } : undefined}
      >
        {value}
      </dd>
    </div>
  );
}
