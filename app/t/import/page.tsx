"use client";

import { PageTopBar } from "@/components/shell/PageTopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveMealTemplate } from "@/lib/db";
import { reportStorageError } from "@/lib/storage-status";
import {
  decodeSharedTemplate,
  type ShareableTemplate,
} from "@/lib/template-share";
import { useState } from "react";
import { AlertCircle, ChefHat, Check, Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

/** Recipient-side landing for a shared meal template.
 *
 *  The shared URL looks like `/t/import#data=<base64url>`. The
 *  fragment is client-only — the server never sees it — so this
 *  page is purely client-rendered: read `window.location.hash`,
 *  decode + validate, render a preview, and on confirm call
 *  `saveMealTemplate` to write to IDB.
 *
 *  Failure modes are surfaced clearly: a malformed payload reads
 *  as "broken link" rather than crashing. Successful imports
 *  redirect into /app so the user lands on the calculator with
 *  the template already in their list.
 *
 *  Editable name pre-fill: shared templates often need renaming
 *  ("Sara's lunch" → "Sara's lunch v2") so we expose the input
 *  before the import, not after. Foods are not editable here —
 *  if the recipient wants to tweak, they import then edit. */
export default function TemplateImportPage() {
  const tBar = useTranslations("pageTopBar");
  return (
    <>
      <PageTopBar
        href="/app"
        label={tBar("backToApp")}
      />
      <main className="mx-auto max-w-2xl px-safe-or-6 py-8">
        <ImportFlow />
      </main>
    </>
  );
}

type FlowState =
  | { kind: "loading" }
  | { kind: "ready"; template: ShareableTemplate }
  | { kind: "error"; message: string }
  | { kind: "done"; name: string };

/** Parse the URL fragment to derive the initial state. Runs once
 *  inside the `useState` lazy initializer so we don't need an
 *  effect that immediately setState's — that violates the
 *  set-state-in-effect rule + causes a render flash. On the
 *  server-rendered pass we return "loading" so the SSR markup
 *  matches; the client first render then has `window.location`
 *  and resolves to "ready" / "error" without another render. */
function parseFromHash(): FlowState {
  if (typeof window === "undefined") return { kind: "loading" };
  const raw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(raw);
  const data = params.get("data");
  if (!data) {
    return {
      kind: "error",
      message:
        "This link is missing its template data. The sharer may have copied only part of the URL — ask them to send the whole thing.",
    };
  }
  const result = decodeSharedTemplate(data);
  if (!result.ok) {
    return { kind: "error", message: errorMessage(result.reason) };
  }
  return { kind: "ready", template: result.template };
}

function ImportFlow() {
  const [state, setState] = useState<FlowState>(parseFromHash);
  const [renamedTo, setRenamedTo] = useState<string>(() =>
    state.kind === "ready" ? state.template.name : "",
  );
  const [busy, setBusy] = useState(false);

  async function importTemplate() {
    if (state.kind !== "ready" || busy) return;
    setBusy(true);
    try {
      await saveMealTemplate({
        name: renamedTo.trim() || state.template.name,
        foods: state.template.foods,
      });
      setState({ kind: "done", name: renamedTo.trim() || state.template.name });
      toast.success("Template imported.");
    } catch (err) {
      reportStorageError(err);
      toast.error(
        err instanceof Error
          ? `Couldn't save: ${err.message}`
          : "Couldn't save the template.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Reading link…
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="rounded-lg border border-red-500/30 bg-red-500/5 px-5 py-4 text-sm">
        <header className="flex items-center gap-2 text-red-700 dark:text-red-300">
          <AlertCircle className="h-4 w-4" />
          <h1 className="font-semibold">Can&apos;t open this link</h1>
        </header>
        <p className="mt-2 leading-relaxed text-foreground">{state.message}</p>
      </section>
    );
  }

  if (state.kind === "done") {
    return (
      <section className="space-y-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-5 py-5 text-sm">
        <header className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
          <Check className="h-4 w-4" />
          <h1 className="font-semibold">Imported &ldquo;{state.name}&rdquo;</h1>
        </header>
        <p className="leading-relaxed text-foreground">
          It&apos;s now in your templates. Open it from the Meal Plan tab and
          tap &ldquo;Apply template&rdquo; on any meal slot, or manage it from
          Templates.
        </p>
        <a
          href="/app"
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Open the app
        </a>
      </section>
    );
  }

  const { template } = state;
  const totals = sumMacros(template.foods);

  return (
    <section className="space-y-5">
      <header className="space-y-1.5">
        <p className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <ChefHat className="h-3 w-3" />
          Shared meal template
        </p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {template.name}
        </h1>
        <p className="text-xs text-muted-foreground">
          {template.foods.length} food
          {template.foods.length === 1 ? "" : "s"} ·{" "}
          {Math.round(totals.calories)} kcal total
        </p>
      </header>

      <div className="rounded-lg border border-border/60 bg-card px-5 py-4">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Totals
        </p>
        <div className="mt-2 grid grid-cols-4 gap-3 text-center">
          <Totals
            label="kcal"
            value={Math.round(totals.calories)}
          />
          <Totals
            label="Protein"
            value={`${Math.round(totals.protein)} g`}
          />
          <Totals
            label="Carbs"
            value={`${Math.round(totals.carbs)} g`}
          />
          <Totals
            label="Fat"
            value={`${Math.round(totals.fat)} g`}
          />
        </div>
      </div>

      <section className="rounded-lg border border-border/60 bg-card">
        <header className="border-b border-border/60 px-5 py-3">
          <h2 className="text-sm font-semibold tracking-tight">Foods</h2>
        </header>
        <ul className="divide-y divide-border/60 text-sm">
          {template.foods.map((food, i) => (
            <li
              key={`${food.id}-${i}`}
              className="flex items-baseline justify-between gap-3 px-5 py-2.5"
            >
              <span className="truncate">
                {food.name}
                <span className="ml-2 text-[11px] text-muted-foreground">
                  {food.portionSize} g
                </span>
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                {Math.round(food.calories)} kcal
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-border/60 bg-card px-5 py-4">
        <Label
          htmlFor="import-name"
          className="text-xs font-medium text-muted-foreground"
        >
          Save as
        </Label>
        <Input
          id="import-name"
          value={renamedTo}
          onChange={(e) => setRenamedTo(e.target.value)}
          className="mt-1.5"
          placeholder={template.name}
          maxLength={120}
        />
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Goes to your templates on this device. Sign in to sync across devices.
        </p>
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            onClick={() => void importTemplate()}
            disabled={busy || renamedTo.trim() === ""}
            className="gap-1.5"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            {busy ? "Importing…" : "Import template"}
          </Button>
          <a
            href="/app"
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/40"
          >
            Skip
          </a>
        </div>
      </section>
    </section>
  );
}

function Totals({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="font-mono text-base font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function sumMacros(foods: ShareableTemplate["foods"]): {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
} {
  let calories = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  for (const food of foods) {
    calories += food.calories;
    protein += food.protein;
    carbs += food.carbs;
    fat += food.fat;
  }
  return { calories, protein, carbs, fat };
}

function errorMessage(
  reason:
    | "malformed-base64"
    | "malformed-json"
    | "wrong-shape"
    | "unsupported-version",
): string {
  switch (reason) {
    case "malformed-base64":
      return "The link's data is garbled. Ask the sender to copy the whole URL again — most often this happens when a chat app silently inserts a line break.";
    case "malformed-json":
      return "The link's data is corrupted. Ask the sender for a fresh share.";
    case "wrong-shape":
      return "The shared template doesn't look right — the format may have changed since it was created. Ask the sender to re-share from a current version of Maqro.";
    case "unsupported-version":
      return "This link uses a newer share format than this version of Maqro understands. Update the app from the About page and try again.";
  }
}
