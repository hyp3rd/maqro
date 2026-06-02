"use client";

import { mealIcon } from "@/lib/meal-icon";
import { useState } from "react";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Mic,
  Search,
  ScanLine,
  Soup,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import type { Meal } from "./types";

/** The "how" the user wants to log to the chosen meal. Each maps to a
 *  full-screen tool the parent opens (search overlay, camera, recipe /
 *  template picker, voice sheet). */
export type LogMethod =
  | "search"
  | "recipe"
  | "template"
  | "barcode"
  | "photo"
  | "voice";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meals: Meal[];
  /** Whether AI features (photo identify, voice log) are wired. Gates
   *  the Photo + Voice methods so they don't appear when they'd 503. */
  aiAvailable: boolean;
  /** When set, the launcher opens straight at the method step for this
   *  meal — used when a tool's "Back" returns the user here without
   *  re-asking which meal. `null` starts at the meal picker. */
  initialMealId?: number | null;
  /** Fires once the user has chosen a meal *and* a method. The parent
   *  opens the matching full-screen tool, pre-targeted to `mealId`, and
   *  closes this launcher. */
  onMethod: (method: LogMethod, mealId: number) => void;
};

type MethodTile = {
  key: LogMethod;
  icon: typeof Search;
  label: string;
  hint: string;
  /** Requires AI — hidden when `aiAvailable` is false. */
  ai?: boolean;
};

const METHODS: MethodTile[] = [
  { key: "search", icon: Search, label: "Search", hint: "Food database" },
  { key: "recipe", icon: Soup, label: "Recipe", hint: "A saved recipe" },
  {
    key: "template",
    icon: LayoutGrid,
    label: "Template",
    hint: "A saved meal",
  },
  { key: "barcode", icon: ScanLine, label: "Barcode", hint: "Scan a product" },
  {
    key: "photo",
    icon: Camera,
    label: "Photo",
    hint: "Snap your plate",
    ai: true,
  },
  {
    key: "voice",
    icon: Mic,
    label: "Voice",
    hint: "Say what you ate",
    ai: true,
  },
];

/** Guided "Log meal" launcher. Two quick steps — pick a meal, then pick
 *  *how* to log to it — after which the parent opens the proper
 *  full-screen tool (the small sheet was a poor home for search /
 *  camera / pickers). The stateful flow lives in `LogMealFlow`,
 *  rendered inside DialogContent so Radix unmounts it on close and every
 *  open starts at step 1 with no reset effect. */
export function LogMealSheet({
  open,
  onOpenChange,
  meals,
  aiAvailable,
  initialMealId,
  onMethod,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="gap-3">
        <LogMealFlow
          meals={meals}
          aiAvailable={aiAvailable}
          initialMealId={initialMealId ?? null}
          onMethod={onMethod}
        />
      </DialogContent>
    </Dialog>
  );
}

function LogMealFlow({
  meals,
  aiAvailable,
  initialMealId,
  onMethod,
}: {
  meals: Meal[];
  aiAvailable: boolean;
  initialMealId: number | null;
  onMethod: (method: LogMethod, mealId: number) => void;
}) {
  // `null` = step 1 (pick a meal). Seeded from `initialMealId` so a
  // tool's "Back" returns straight to the method step.
  const [mealId, setMealId] = useState<number | null>(initialMealId);
  const targetMeal = meals.find((m) => m.id === mealId) ?? null;
  const methods = METHODS.filter((m) => !m.ai || aiAvailable);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-left">
          {mealId === null
            ? "Log a meal"
            : `Add to ${targetMeal?.name ?? "meal"}`}
        </DialogTitle>
        <DialogDescription className="text-left">
          {mealId === null
            ? "Where does this go?"
            : "How do you want to log it?"}
        </DialogDescription>
      </DialogHeader>

      <AnimatePresence
        mode="wait"
        initial={false}
      >
        {mealId === null ? (
          <motion.div
            key="meal"
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.16 }}
            className="grid grid-cols-2 gap-2 pt-1"
          >
            {meals.map((meal) => {
              const kcal = meal.foods.reduce((s, f) => s + f.calories, 0);
              const Icon = mealIcon(meal.name);
              return (
                <button
                  key={meal.id}
                  type="button"
                  onClick={() => setMealId(meal.id)}
                  className="flex min-h-20 flex-col items-start justify-between rounded-xl border border-border/60 bg-card p-3 text-left transition-colors active:bg-muted"
                >
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <span className="mt-2 w-full">
                    <span className="block text-sm font-medium text-foreground">
                      {meal.name}
                    </span>
                    <span className="block font-mono text-[11px] tabular-nums text-muted-foreground">
                      {kcal > 0 ? `${kcal} kcal logged` : "empty"}
                    </span>
                  </span>
                </button>
              );
            })}
          </motion.div>
        ) : (
          <motion.div
            key="method"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ duration: 0.16 }}
            className="space-y-3 pt-1"
          >
            <button
              type="button"
              onClick={() => setMealId(null)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors active:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Change meal
            </button>

            <div className="grid grid-cols-2 gap-2">
              {methods.map(({ key, icon: Icon, label, hint }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onMethod(key, mealId)}
                  className="flex min-h-24 flex-col items-start justify-between rounded-xl border border-border/60 bg-card p-3 text-left transition-colors active:bg-muted"
                >
                  <Icon className="h-6 w-6 text-foreground" />
                  <span className="mt-2 w-full">
                    <span className="flex items-center justify-between gap-1">
                      <span className="text-sm font-medium text-foreground">
                        {label}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {hint}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
