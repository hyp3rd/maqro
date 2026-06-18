"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { offCodeFromFoodId } from "@maqro/core/off";
import type { ResolvedMealPhoto } from "./app/api/identify-meal/route";
import { SignInPromptDialog } from "./components/auth/SignInPromptDialog";
import { AdvancedSettingsSection } from "./components/macro/AdvancedSettingsSection";
import { ApplyRecipeDialog } from "./components/macro/ApplyRecipeDialog";
import { ApplyTemplateDialog } from "./components/macro/ApplyTemplateDialog";
import { BodySummaryStrip } from "./components/macro/BodySummaryStrip";
import { CameraSheet } from "./components/macro/CameraSheet";
import { CustomFoodForm } from "./components/macro/CustomFoodForm";
import { FastingView } from "./components/macro/FastingView";
import { FoodSearchSheet } from "./components/macro/FoodSearchSheet";
import { GoalPhasesPlanner } from "./components/macro/GoalPhasesPlanner";
import { LogMealSheet, type LogMethod } from "./components/macro/LogMealSheet";
import MacroResults from "./components/macro/MacroResults";
import {
  MealHubSheet,
  type MealHubIntent,
} from "./components/macro/MealHubSheet";
import { MealPhotoReviewDialog } from "./components/macro/MealPhotoReviewDialog";
import MealPlanner from "./components/macro/MealPlanner";
import { MyFoodsView } from "./components/macro/MyFoodsView";
import { PairPhoneDialog } from "./components/macro/PairPhoneDialog";
import { PantryView } from "./components/macro/PantryView";
import PersonalInfoForm from "./components/macro/PersonalInfoForm";
import { ProfileView } from "./components/macro/ProfileView";
import { ProgressView } from "./components/macro/ProgressView";
import { RecipesView } from "./components/macro/RecipesView";
import { SaveTemplateDialog } from "./components/macro/SaveTemplateDialog";
import { SettingsView } from "./components/macro/SettingsView";
import { ShoppingListView } from "./components/macro/ShoppingListView";
import { SuggestDayDialog } from "./components/macro/SuggestDayDialog";
import { TemplatesView } from "./components/macro/TemplatesView";
import { UpgradeDialog } from "./components/macro/UpgradeDialog";
import { VoiceLogSheet } from "./components/macro/VoiceLogSheet";
import {
  CalculatedValues,
  Food,
  FoodItem,
  type GoalPhase,
  type MacroSplit,
  Meal,
  PersonalInfo,
  type Recipe,
  TotalMacros,
} from "./components/macro/types";
import { OnboardingWizard } from "./components/onboarding/OnboardingWizard";
import { AppShell } from "./components/shell/AppShell";
import type { ViewKey } from "./components/shell/Sidebar";
import { foodDatabase } from "./data/food-database";
import { useAiUsage } from "./hooks/use-ai-usage";
import { useDailyLog } from "./hooks/use-daily-log";
import { useFoodSearch } from "./hooks/use-food-search";
import { useIsMobile } from "./hooks/use-mobile";
import { useProfile } from "./hooks/use-profile";
import { useToday } from "./hooks/use-today";
import { useUser } from "./hooks/use-user";
import { addedFoodMessage } from "./lib/add-food-constants";
import { requestAiMealPlan } from "./lib/ai-plan";
import type { CoherenceIssue } from "./lib/ai/plan-coherence";
import { clientFetch } from "./lib/auth/client-fetch";
import { FEATURES } from "./lib/billing/tiers";
import {
  addCustomFood,
  customToFood,
  getDailyLog,
  listCustomFoods,
  listDailyLogs,
  listMealSchedules,
  listMicronutrientProfiles,
  listPantryItems,
  listRecipes,
  saveDailyLog,
  todayKey,
  type MealSchedule,
  type MealTemplate,
  type PantryItem,
} from "./lib/db";
import { dietBreakNudge, effectiveGoal } from "./lib/goal-phases";
import { haptic } from "./lib/haptics";
import { waterGoalMl } from "./lib/hydration";
import { addFoodBasis, scaleFoodToItem } from "./lib/log-food";
import { computeMacros, rescaleFoodMacros, scaleSubMacros } from "./lib/macros";
import { getMarket, setHomeMarket } from "./lib/market";
import { planDay, summarisePlan } from "./lib/meal-planner";
import { recipeIngredientToFood } from "./lib/meal-prep-batch";
import { aggregateBreakdownWithProfiles } from "./lib/micronutrients/aggregate";
import type { MicronutrientProfile } from "./lib/micronutrients/types";
import { applyPantryDelta } from "./lib/pantry/apply-delta";
import {
  consumedUnitAmount,
  matchPantryItem,
  planPerFoodConsumption,
  planPerFoodConsumptionAgainstBalance,
  roundQuantity,
} from "./lib/pantry/consume";
import { replanPantryDeltas } from "./lib/pantry/replan";
import { extractFoodPreferences } from "./lib/personalization/preferences";
import { computeSlotBudget } from "./lib/recipe-ranking";
import { scaleRecipeIngredients } from "./lib/scale-recipe";
import { reportStorageError } from "./lib/storage-status";
import { bumpPending, useSyncStatus } from "./lib/sync-status";
import { useDataRev } from "./lib/sync/data-bus";

const DEFAULT_PROFILE: PersonalInfo = {
  displayName: null,
  gender: "male",
  age: 30,
  weight: 70,
  height: 175,
  activityLevel: "moderate",
  goal: "maintain",
  dietType: "balanced",
  dietPreference: "omnivore",
  cuisinePreferences: [],
  allergies: [],
  dislikedFoods: [],
  weeklyRateKg: 0.5,
  manualTdee: null,
  macroSplit: null,
  // Default is metric. On the client, the auto-detect effect below
  // upgrades this to "imperial" for US / Liberia / Myanmar locales
  // before the first paint of the user's data; pre-hydration SSR
  // and SSR fallbacks keep showing metric so we don't ship hydration
  // mismatches.
  units: "metric",
};

const DEFAULT_MEALS: Meal[] = [
  { id: 1, name: "Breakfast", foods: [] },
  { id: 2, name: "Lunch", foods: [] },
  { id: 3, name: "Dinner", foods: [] },
  { id: 4, name: "Snacks", foods: [] },
];

/** Convert a Blob to a bare base64 string (no data: prefix), as
 *  /api/identify-meal expects. Shared by the in-sheet photo flow and
 *  the paired-phone photo flow. FileReader is the most compatible
 *  cross-browser path. */
/** Mint a numeric seed for cloning a batch of FoodItems with distinct
 *  monotonically-increasing ids. Hoisted to module scope so React
 *  Compiler's "no impure call in render" rule (which doesn't traverse
 *  opaque function calls) doesn't flag the inline `Date.now()` inside
 *  event handlers it infers as candidates for auto-memoization. */
function freshIdSeed(): number {
  return Date.now();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read blob."));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read blob."));
    reader.readAsDataURL(blob);
  });
}

/** Load the two personalization signals the AI routes accept as a
 *  soft bias: the user's recent food rotation (from daily logs) and
 *  their pantry-on-hand. Failure-tolerant — an IDB hiccup on either
 *  yields an empty array for that signal and NEVER blocks generation.
 *  Shared by every `requestAiMealPlan` call site (auto-fill, refine,
 *  per-meal regenerate) so they stay consistent. */
async function loadAiBiasSignals(): Promise<{
  recentlyEatenFoods: { name: string; count: number }[];
  pantryItems: { name: string; quantity: number; unit: string }[];
}> {
  let recentlyEatenFoods: { name: string; count: number }[] = [];
  let pantryItems: { name: string; quantity: number; unit: string }[] = [];
  try {
    const logs = await listDailyLogs();
    recentlyEatenFoods = extractFoodPreferences(logs, { todayKey: todayKey() });
  } catch {
    // No rotation bias on this call.
  }
  try {
    const rows = await listPantryItems();
    pantryItems = rows.map((p) => ({
      name: p.name,
      quantity: p.quantity,
      unit: p.unit,
    }));
  } catch {
    // No pantry bias on this call.
  }
  return { recentlyEatenFoods, pantryItems };
}

/** localStorage key recording the user's "I've completed (or
 *  dismissed) the onboarding wizard" state. Per-device by design -
 *  signing in on a new device shows the wizard again, but the
 *  wizard pre-fills from any synced profile so the user just clicks
 *  through. Wiping site data resets the flag. */
const ONBOARDING_DONE_KEY = "maqro:onboarding-done";

function hasCompletedOnboarding(): boolean {
  if (typeof window === "undefined") return true; // SSR - don't flash the wizard
  try {
    return window.localStorage.getItem(ONBOARDING_DONE_KEY) === "1";
  } catch {
    // localStorage disabled / quota exceeded - fail safe by NOT
    // showing the wizard repeatedly (more annoying than missing it).
    return true;
  }
}

function markOnboardingDone(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ONBOARDING_DONE_KEY, "1");
  } catch {
    // Best-effort; if storage is unavailable the wizard will re-show
    // next load, which is the safer of the two failure modes.
  }
}

/** "Has this user already configured a profile?" - derived from
 *  whether the basics differ from the defaults. Used together with
 *  the localStorage flag to decide whether to show the onboarding
 *  wizard on first load: a returning user whose profile is non-default
 *  has clearly used the app before, so we don't onboard them again
 *  even if the device-local flag is missing. */
/** Whitelist of legal `?view=` values, kept in sync with ViewKey.
 *  Anything outside this set (typos, removed views, hostile URLs)
 *  falls back to "calculator". Living next to the ViewKey type lets
 *  TS catch drift via the exhaustive `satisfies` check below. */
const VIEW_PARAM_VALUES = [
  "calculator",
  "profile",
  "plan",
  "progress",
  "fasting",
  "foods",
  "recipes",
  "templates",
  "shopping",
  "pantry",
  "settings",
] as const satisfies readonly ViewKey[];

function viewFromParam(raw: string | null): ViewKey {
  if (raw === null) return "calculator";
  return (VIEW_PARAM_VALUES as readonly string[]).includes(raw)
    ? (raw as ViewKey)
    : "calculator";
}

function isDefaultProfile(p: PersonalInfo): boolean {
  return (
    p.age === DEFAULT_PROFILE.age &&
    p.weight === DEFAULT_PROFILE.weight &&
    p.height === DEFAULT_PROFILE.height &&
    p.gender === DEFAULT_PROFILE.gender &&
    p.activityLevel === DEFAULT_PROFILE.activityLevel &&
    p.goal === DEFAULT_PROFILE.goal &&
    p.dietPreference === DEFAULT_PROFILE.dietPreference
  );
}

const MacroCalculator = () => {
  // Persisted profile. Defaults are used until the IndexedDB hydration
  // completes (a few ms after mount).
  const {
    profile: personalInfo,
    setProfile: setPersonalInfo,
    patchProfile,
    isHydrated: profileHydrated,
  } = useProfile(DEFAULT_PROFILE);

  // Onboarding: show the wizard if the device hasn't seen it AND the
  // hydrated profile is still the default. The latter check avoids
  // re-onboarding users whose data synced from another device before
  // they got a chance to dismiss it.
  const [onboardingOpen, setOnboardingOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return !hasCompletedOnboarding();
  });
  // Grace window so the wizard doesn't FLASH for a fraction of a
  // second on devices where IDB hydrates as default (empty cache,
  // signed-in user on a wiped device, hard refresh) BEFORE the
  // initial sync pulls the real profile in. We open the gate when
  // EITHER: (a) sync has touched the profile store (profileRev > 0),
  // OR (b) the 1.5s safety timeout fired AND no initial sync is still
  // in flight. The sync guard is what actually closes the flash: a
  // returning user on a fresh device whose pull runs longer than the
  // timeout used to see the wizard for a frame before the synced
  // (non-default) profile arrived and shut it. Gating (b) on
  // `syncStatus` holds the gate closed until the pull settles, after
  // which (a) or (b) opens it. The OR is derived directly from state -
  // the timeout only updates `gateTimeoutFired` inside its callback,
  // never synchronously in an effect body (would violate the
  // set-state-in-effect rule).
  const profileRev = useDataRev("profile");
  const syncStatus = useSyncStatus();
  const [gateTimeoutFired, setGateTimeoutFired] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setGateTimeoutFired(true), 1500);
    return () => window.clearTimeout(t);
  }, []);
  const onboardingGateOpen =
    profileRev > 0 || (gateTimeoutFired && syncStatus.state !== "syncing");

  // Mirror the synced home market into the food-search market resolver, so the
  // search defaults to the user's chosen market across devices (a per-device
  // override still wins locally). See lib/market.ts.
  useEffect(() => {
    setHomeMarket(personalInfo.market);
  }, [personalInfo.market]);

  // Currently displayed day. `null` means "follow today" - useful so the
  // log live-updates across midnight when the user isn't pinned to a
  // specific historical date.
  const today = useToday();
  const [explicitDate, setExplicitDate] = useState<string | null>(null);
  const selectedDate = explicitDate ?? today;

  const {
    meals,
    setMeals,
    isHydrated: dayHydrated,
  } = useDailyLog(selectedDate, DEFAULT_MEALS);
  // Latest meals / selected date / hydration for deferred callbacks (the Undo
  // toasts fire seconds after the removing render, possibly after the user
  // navigated to another day) — setMeals isn't a functional updater. Synced in
  // an effect because writing refs during render is disallowed.
  const mealsRef = useRef(meals);
  const selectedDateRef = useRef(selectedDate);
  const dayHydratedRef = useRef(dayHydrated);
  useEffect(() => {
    mealsRef.current = meals;
    selectedDateRef.current = selectedDate;
    dayHydratedRef.current = dayHydrated;
  }, [meals, selectedDate, dayHydrated]);

  // State for new food being added
  const [newFood, setNewFood] = useState<FoodItem>({
    id: 0,
    name: "",
    protein: 0,
    carbs: 0,
    fat: 0,
    calories: 0,
    portionSize: 0,
    selectedMealId: 1,
  });

  // State for meal plan generation
  const [isGeneratingMealPlan, setIsGeneratingMealPlan] = useState(false);
  /** Which meal slot is currently being (re)generated, if any. `null`
   *  when no per-meal AI call is in flight (the full-day Auto-fill and
   *  refiner pills don't set this - they're not scoped to a single
   *  slot). Powers the per-meal loading indicator so the user sees
   *  WHICH meal is being worked on, not just "AI is busy". */
  const [generatingMealId, setGeneratingMealId] = useState<number | null>(null);
  const [mealPlanMessage, setMealPlanMessage] = useState("");
  /** Validator complaints the AI couldn't self-correct on the most
   *  recent generate/refine/regenerate call. Empty array means the
   *  plan is clean. Surfaced inline in the MealPlanner — per-meal
   *  issues anchor to the offending meal card, day-level ones render
   *  as a banner. Cleared at the start of any new AI request so
   *  stale warnings don't outlive the plan they were complaining
   *  about. */
  const [coherenceIssues, setCoherenceIssues] = useState<CoherenceIssue[]>([]);

  // State for editing food portions
  const [editingFood, setEditingFood] = useState<{
    mealId: number | null;
    foodId: number | null;
    portionSize: number;
    originalFood: FoodItem | null;
  }>({ mealId: null, foodId: null, portionSize: 0, originalFood: null });

  // State for replacing food
  const [replacingFood, setReplacingFood] = useState<{
    mealId: number | null;
    foodId: number | null;
    portionSize: number;
    searchTerm: string;
    suggestions: Food[];
    showSuggestions: boolean;
  }>({
    mealId: null,
    foodId: null,
    portionSize: 0,
    searchTerm: "",
    suggestions: [],
    showSuggestions: false,
  });

  // State for food search and suggestions
  const [foodSearch, setFoodSearch] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Per-100g reference for the last-picked food. Drives portion recalculation
  // across all three sources (builtin / custom / OFF) without re-querying.
  const [selectedFood, setSelectedFood] = useState<Food | null>(null);
  // Bump to force the search hook to re-query custom foods after a save.
  const [customFoodsRev, setCustomFoodsRev] = useState(0);
  const [customFoodOpen, setCustomFoodOpen] = useState(false);
  // Camera/barcode entry-point dialog. Opens from AddFoodForm's
  // "Camera" button. Barcode path: resolved Food flows back through
  // `handleFoodSelect` like a typed-search pick. Photo path: AI
  // returns a multi-food list → `MealPhotoReviewDialog` opens for
  // review + bulk-add.
  const [cameraSheetOpen, setCameraSheetOpen] = useState(false);
  // Voice-log sheet shares the same `mealPhotoResult` state as the
  // camera path because the two flows produce the same
  // `ResolvedMealPhoto` shape and both hand off to the SAME review
  // dialog. The user can only run one capture at a time, so one
  // result slot is sufficient.
  const [voiceSheetOpen, setVoiceSheetOpen] = useState(false);
  const [mealPhotoResult, setMealPhotoResult] =
    useState<ResolvedMealPhoto | null>(null);
  // Phone pairing flow. Only offered on desktop (mobile has the camera
  // right there). Opens from a footer link inside CameraSheet. Errors
  // during paired-capture processing surface via `mealPlanMessage` so
  // they share the topbar status channel rather than carrying a third
  // error-state pipeline.
  const [pairPhoneOpen, setPairPhoneOpen] = useState(false);
  const isMobile = useIsMobile();
  // AI route is auth-gated; surface the Photo tab only when signed in.
  // The Anthropic env gate runs server-side - clicking with a stale
  // session surfaces a clear 503 error in the sheet's error state.
  const { user, isLoaded: authLoaded, isUnconfigured } = useUser();

  // URL-driven upgrade dialog. The landing page's "Start free trial"
  // CTAs link to `/app?upgrade=plus` (or `pro`) so a visitor lands
  // straight in the checkout flow.
  //
  // `useSearchParams` is the only reliable way to read the URL in a
  // client component that's also server-rendered: a `useState` lazy
  // initializer would run on the server (where `typeof window ===
  // "undefined"` → returns null) and client hydration would reuse
  // that null forever. `useSearchParams` returns the real URL params
  // on both server and client, so the value is correct from the
  // first render.
  const searchParams = useSearchParams();
  const urlUpgradeParam = searchParams.get("upgrade");
  const urlPlan: "plus" | "pro" | null =
    urlUpgradeParam === "plus" || urlUpgradeParam === "pro"
      ? urlUpgradeParam
      : null;
  // Tracks whether the user closed the dialog this session - once
  // they have, we don't reopen even if the URL still has the
  // param. Cleared by navigation away.
  const [upgradeDialogDismissed, setUpgradeDialogDismissed] = useState(false);
  // Gate modals for AI actions: a signed-out user gets the sign-in prompt
  // (the string is the feature name shown in its copy); a capped free user
  // gets the upgrade dialog with the ai-cap framing.
  const [signInPromptFeature, setSignInPromptFeature] = useState<string | null>(
    null,
  );
  const [capUpgradeOpen, setCapUpgradeOpen] = useState(false);
  const [suggestDayOpen, setSuggestDayOpen] = useState(false);
  // Meal templates: which dialog is open and for which meal. `null` =
  // no dialog. The dialogs themselves read templates from IDB on open.
  const [templateDialog, setTemplateDialog] = useState<
    { kind: "save"; mealId: number } | { kind: "apply"; mealId: number } | null
  >(null);
  // Apply-recipe dialog: which meal slot the user wants to apply a recipe
  // into. `null` = closed.
  const [applyRecipeMealId, setApplyRecipeMealId] = useState<number | null>(
    null,
  );
  // Guided "Log meal" flow — the mobile-first add-food entry point. The
  // launcher (`logMealOpen`) picks a meal + method, then opens the
  // matching full-screen tool, pre-targeted to `logTargetMealId`:
  //   - search  → FoodSearchSheet (`foodSearchOpen`) → logFoodToMeal
  //   - barcode/photo → CameraSheet (`cameraMode` seeds the tab)
  //   - voice   → VoiceLogSheet
  //   - recipe/template → the existing pickers (applyRecipeMealId / templateDialog)
  // `logTargetMealId` lets the camera barcode + photo/voice review route
  // back to the chosen meal instead of the (mobile-hidden) inline form.
  const [logMealOpen, setLogMealOpen] = useState(false);
  const [foodSearchOpen, setFoodSearchOpen] = useState(false);
  const [logTargetMealId, setLogTargetMealId] = useState<number | null>(null);
  const [cameraMode, setCameraMode] = useState<"scan" | "photo">("scan");
  // Non-null while a tool was launched from the guided launcher: it
  // names the meal to return to, so each tool can show a "Back" that
  // reopens the launcher at the method step. Meal-menu entries leave it
  // null (those tools just close).
  const [logFlowMealId, setLogFlowMealId] = useState<number | null>(null);
  // Meal hub: which meal slot's hub is open (by id), and why it was opened —
  // "add" leads with the "Log this again" strip, "insights" leads with the
  // read-only insights body (see MealHubSheet's entry-dependent ordering).
  const [mealDetailId, setMealDetailId] = useState<number | null>(null);
  const [mealHubIntent, setMealHubIntent] = useState<MealHubIntent>("add");
  // Pulse signal for the most-recently-logged meal slot. A fresh object
  // each log (identity, not value, drives the consumer's effect) so the
  // target MealItem flashes + scrolls into view even when the same meal
  // is logged twice in a row. Null until the first add this session.
  const [loggedMealSignal, setLoggedMealSignal] = useState<{
    mealId: number;
  } | null>(null);
  /** Fire the "food landed" feedback for `mealId`: a success haptic plus
   *  the visual pulse on that meal card. Funnelled through every add path
   *  (inline form, guided search, recents, recipe/template copy) so the
   *  confirmation is identical regardless of how the food got there. */
  const signalMealLogged = (mealId: number) => {
    haptic("success");
    setLoggedMealSignal({ mealId });
  };
  // Initial view honors `?view=…` if present, so links from emails
  // ("Manage email preferences" → /app?view=settings, weekly recap →
  // /app?view=progress) and the Stripe Customer Portal's return URL
  // land on the right tab. The set of valid values mirrors ViewKey
  // 1:1 so an unknown param falls back to the default. The lazy
  // initializer reads `searchParams` (which Next supplies on both
  // server and client), so the initial render is correct without
  // any post-mount setState dance.
  const [view, setView] = useState<ViewKey>(() =>
    viewFromParam(searchParams.get("view")),
  );

  const search = useFoodSearch(foodSearch, customFoodsRev);
  const foodSuggestions = search.results;

  // The inline "replace this food" search runs through the SAME multi-source
  // search as adding a food (your foods + built-in + CIQUAL + Open Food Facts)
  // — not the tiny built-in catalog it used to filter, which made replacing
  // almost any real food turn up nothing. Idle (empty results, no network)
  // until the user is replacing and has typed a query.
  const replaceSearch = useFoodSearch(replacingFood.searchTerm, customFoodsRev);

  // State for portion size
  const [portionSize, setPortionSize] = useState(100); // Default 100g

  // Live pantry inventory — drives the "In pantry" badges in the food
  // search and the synchronous match-at-add-time used to draw the
  // pantry down. Re-read on every realtime arrival via `useDataRev`,
  // the same pattern PantryView uses. Failure-tolerant: a read error
  // just leaves the list empty (no badges, no draw-down).
  const [pantryItems, setPantryItems] = useState<PantryItem[]>([]);
  const pantryRev = useDataRev("pantryItems");
  useEffect(() => {
    let cancelled = false;
    listPantryItems()
      .then((rows) => {
        if (!cancelled) setPantryItems(rows);
      })
      .catch(() => {
        // No pantry features on this session; non-fatal.
      });
    return () => {
      cancelled = true;
    };
  }, [pantryRev]);

  // Meal schedules — recipe-to-slot plans surfaced on their matching day as a
  // one-tap "log it" offer (never written ahead). Re-read on realtime arrival,
  // same pattern as the pantry above.
  const [mealSchedules, setMealSchedules] = useState<MealSchedule[]>([]);
  const mealSchedulesRev = useDataRev("mealSchedules");
  useEffect(() => {
    let cancelled = false;
    listMealSchedules()
      .then((rows) => {
        if (!cancelled) setMealSchedules(rows);
      })
      .catch(() => {
        // No schedules / no IDB on this session; non-fatal.
      });
    return () => {
      cancelled = true;
    };
  }, [mealSchedulesRev]);

  // Refs for dropdowns
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const replacementSuggestionsRef = useRef<HTMLDivElement | null>(null);

  // Serializes pantry draw-down writes. Each delta reads-modifies-writes
  // the same row, so overlapping fire-and-forget calls (e.g. replace =
  // restore-old + draw-new on the same item, or rapid edits) would race
  // on a stale read and clobber each other. Chaining them guarantees
  // each sees the previous write.

  // Handle clicks outside suggestions dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Handle clicks outside replacement suggestions dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        replacementSuggestionsRef.current &&
        !replacementSuggestionsRef.current.contains(event.target as Node)
      ) {
        setReplacingFood((prev) => ({ ...prev, showSuggestions: false }));
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Side effects for the URL-driven upgrade flow. No setState lives
  // in this effect - the dialog's open state is derived from the URL
  // + auth + the `upgradeDialogDismissed` flag (set only from the
  // dialog's own onOpenChange). Outcomes:
  //   - signed-in user → derived state opens the dialog (no-op here)
  //   - unconfigured Supabase → toast (dialog won't open anyway
  //     because user is null)
  //   - signed-out + configured → bounce to /login?next=<this URL>,
  //     so they land back on `/app?upgrade=…` after sign-in and the
  //     dialog opens on the next mount.
  useEffect(() => {
    if (!urlPlan) return;
    if (!authLoaded) return;
    if (user) return; // dialog opens via derived state below
    if (isUnconfigured) {
      toast.error("Upgrades aren't available on this deployment.");
      return;
    }
    const next = encodeURIComponent(`/app?upgrade=${urlPlan}`);
    window.location.href = `/login?next=${next}`;
  }, [urlPlan, authLoaded, user, isUnconfigured]);

  // Dialog open state - purely derived. URL has a valid plan AND
  // auth is resolved AND a user is signed in AND the user hasn't
  // dismissed the dialog this session.
  const upgradeDialogOpen =
    urlPlan !== null && authLoaded && user !== null && !upgradeDialogDismissed;

  // Goal phases (Pro): the phase active on today's date overrides the linear
  // goal/rate fed into computeMacros, so the calorie/macro target shifts as
  // phases transition. Gated on the live tier — while it loads (or for
  // free/downgraded users) `phasesEnabled` is false and the linear goal
  // drives the target, so the number is never wrong-by-default.
  const { state: aiUsageState } = useAiUsage();
  const goalPhasesEnabled =
    aiUsageState.status === "ok" &&
    FEATURES.canUseGoalPhases(aiUsageState.data.tier);
  const effective = effectiveGoal(personalInfo, today, {
    phasesEnabled: goalPhasesEnabled,
  });
  const activeGoalPhase = effective.phase;
  const goalPhaseNudge = goalPhasesEnabled
    ? dietBreakNudge(personalInfo.goalPhases, today)
    : null;

  // Pin the macro math to the local day so a birthdate-derived age rolls the
  // target over at midnight. Empty `today` (SSR/first paint) leaves `now`
  // undefined, letting computeMacros fall back to the present. Passing it
  // explicitly (rather than relying on a hidden Date.now()) is also what keeps
  // it an honest memo dependency.
  const nowMs = today ? new Date(`${today}T00:00:00`).getTime() : undefined;
  const calculatedValues = useMemo<CalculatedValues>(
    () =>
      computeMacros(
        {
          ...personalInfo,
          goal: effective.goal,
          weeklyRateKg: effective.weeklyRateKg,
        },
        nowMs,
      ),
    [personalInfo, effective.goal, effective.weeklyRateKg, nowMs],
  );

  // Today's calorie target for a *hypothetical* goal-phase list, via the same
  // effectiveGoal → computeMacros pipeline as `calculatedValues` above — so the
  // planner's "this raises your target" guard can never diverge from the real
  // number. A cheap pure read of the current profile + today.
  const targetForPhases = (phasesList: GoalPhase[]): number => {
    const hypo: PersonalInfo = { ...personalInfo, goalPhases: phasesList };
    const eff = effectiveGoal(hypo, today, {
      phasesEnabled: goalPhasesEnabled,
    });
    return computeMacros(
      { ...hypo, goal: eff.goal, weeklyRateKg: eff.weeklyRateKg },
      nowMs,
    ).targetCalories;
  };

  // Derived: aggregate macros across all logged foods.
  const totalMacros = useMemo<TotalMacros>(() => {
    let protein = 0;
    let carbs = 0;
    let fat = 0;
    let calories = 0;

    meals.forEach((meal) => {
      meal.foods.forEach((food) => {
        protein += food.protein;
        carbs += food.carbs;
        fat += food.fat;
        calories += food.calories;
      });
    });

    return {
      protein: Math.round(protein),
      carbs: Math.round(carbs),
      fat: Math.round(fat),
      calories: Math.round(calories),
    };
  }, [meals]);

  /** Derived: optional macro-breakdown (sugars / fiber / fat subtypes).
   *  Returns only the keys at least one food in today's meals
   *  contributed - the display layer hides rows where we have no data
   *  so a blank seed-catalog entry doesn't render misleading "0g".
   *
   *  Resolved per food with the enrichment-profile fallback — the SAME
   *  chain the meal sheet uses — so a food logged without OFF data still
   *  contributes its backfilled sugars/fiber/sat-fat here, and the day
   *  totals can't disagree with the per-meal view. For guests / free
   *  users the profile store is simply empty and this reduces exactly to
   *  the old top-level-only sum. */
  const microProfilesRev = useDataRev("micronutrientProfiles");
  const [microProfiles, setMicroProfiles] = useState<MicronutrientProfile[]>(
    [],
  );
  useEffect(() => {
    let cancelled = false;
    listMicronutrientProfiles()
      .then((rows) => {
        if (!cancelled) setMicroProfiles(rows);
      })
      .catch(() => {
        // Best-effort cache read; the breakdown falls back to the foods'
        // own values.
      });
    return () => {
      cancelled = true;
    };
  }, [microProfilesRev]);
  const macroBreakdown = useMemo(
    () =>
      aggregateBreakdownWithProfiles(
        meals,
        new Map(microProfiles.map((p) => [p.nameKey, p])),
      ),
    [meals, microProfiles],
  );

  // Handle personal info input changes. Accepts arrays so the multi-value
  // fields (cuisinePreferences, allergies, dislikedFoods) and MacroSplit
  // (the optional macro override) can all ride through the same path.
  const handlePersonalInfoChange = (
    name: string,
    value: string | number | null | string[] | MacroSplit | GoalPhase[],
  ) => {
    setPersonalInfo({ ...personalInfo, [name]: value });
  };

  // Handle food search input
  const handleFoodSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFoodSearch(e.target.value);
    setShowSuggestions(e.target.value.trim() !== "");
    // The user is searching anew, so the previously-picked food is stale: drop
    // it so a retyped name can't inherit the old pick's macros/micros/offCode
    // (`addFoodBasis` then rebuilds a bare per-100g food from the grid values).
    // Safe because this fires ONLY on real typing — `handleFoodSelect` sets the
    // box value programmatically, which doesn't trigger this onChange, and a
    // portion-only change never routes through here.
    setSelectedFood(null);
  };

  // Handle food selection from suggestions
  const handleFoodSelect = (food: Food) => {
    setSelectedFood(food);
    setFoodSearch(food.name);
    const ratio = portionSize / 100;
    setNewFood({
      ...newFood,
      name: food.name,
      protein: Number.parseFloat((food.protein * ratio).toFixed(1)),
      carbs: Number.parseFloat((food.carbs * ratio).toFixed(1)),
      fat: Number.parseFloat((food.fat * ratio).toFixed(1)),
      calories: Math.round(food.calories * ratio),
      // Every sub-macro key comes back explicitly (value or undefined), so
      // selecting a new food clears the previous selection's stale values
      // out of the spread-over newFood state.
      ...scaleSubMacros(food, ratio),
      // Per-100g micronutrients pass through UNSCALED — the micro
      // aggregator scales by portion/100 itself (same as it does for
      // the name-keyed profile cache), so storing the raw per-100g
      // object keeps both paths on identical math.
      micronutrients: food.micronutrients,
      // Exact-product provenance for the enrichment cron. Explicitly
      // undefined for non-OFF picks so a prior selection's code clears.
      offCode: offCodeFromFoodId(food.id),
    });
    setShowSuggestions(false);
  };

  // Save an OFF result to the user's custom foods. The food may be
  // the basic search-result shape OR the enriched barcode-lookup
  // shape (preview dialog calls /api/off-barcode to fetch the full
  // breakdown). Either way we pass through every optional macro that
  // came along - search results sometimes carry breakdown fields
  // too, and the barcode-enriched path always does.
  const handleSaveOffToCustom = async (food: Food) => {
    if (food.source !== "off") return;
    await addCustomFood({
      name: food.name,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      calories: food.calories,
      brand: food.brand,
      sugars: food.sugars,
      addedSugars: food.addedSugars,
      fiber: food.fiber,
      saturatedFat: food.saturatedFat,
      transFat: food.transFat,
      monoFat: food.monoFat,
      polyFat: food.polyFat,
      micronutrients: food.micronutrients,
    });
    bumpPending();
    setCustomFoodsRev((r) => r + 1);
  };

  // Called when the CustomFoodForm dialog successfully saves a new food.
  const handleCustomFoodSaved = (food: Food) => {
    setCustomFoodsRev((r) => r + 1);
    handleFoodSelect(food);
  };

  // Append a template's foods to the target meal. Each food gets a fresh
  /** Resolve a phone-side capture (delivered via PairPhoneDialog).
   *  Barcode → look up via OFF; photo → download from Storage, base64,
   *  send to /api/identify-meal. Both paths feed back into the same
   *  state the mobile-direct flow uses, so the downstream UI (search
   *  pick or MealPhotoReviewDialog) renders without further wiring. */
  const handlePairedCapture = async (
    payload:
      | { ready: true; kind: "barcode"; barcode: string }
      | { ready: true; kind: "photo"; photoPath: string },
  ) => {
    setMealPlanMessage("");
    try {
      if (payload.kind === "barcode") {
        const res = await fetch(
          `/api/off-barcode/${encodeURIComponent(payload.barcode)}`,
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? `Lookup failed (HTTP ${res.status})`);
        }
        const data = (await res.json()) as { food?: Food };
        if (!data.food) throw new Error("OFF returned no food.");
        handleFoodSelect(data.food);
        // The food just dropped into the AddFoodForm below - without a
        // visible cue the user (still staring at the now-closed pair
        // dialog) thinks nothing happened. Scroll the form into view
        // and surface a confirmation in the status banner so the next
        // step (pick portion + meal) is obvious.
        setMealPlanMessage(
          `Scanned "${data.food.name}" - pick portion + meal below.`,
        );
        if (typeof document !== "undefined") {
          document
            .getElementById("add-food-form")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }
      // photo path: fetch the blob from Storage, base64 it, identify.
      const { getSupabaseBrowser } = await import("@/lib/supabase/client");
      const supabase = getSupabaseBrowser();
      if (!supabase) throw new Error("Supabase isn't configured.");
      const { data: blob, error: dlError } = await supabase.storage
        .from("captures")
        .download(payload.photoPath);
      if (dlError || !blob) {
        throw new Error(dlError?.message ?? "Photo download failed.");
      }
      const base64 = await blobToBase64(blob);
      // Load customs on demand - same pattern the in-sheet identify
      // flow uses; keeps the wire shape consistent.
      const { listCustomFoods: listFoods } = await import("./lib/db");
      const customs = await listFoods().catch(() => []);
      const aiRes = await clientFetch("/api/identify-meal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageBase64: base64,
          mediaType: "image/jpeg",
          dietPreference: personalInfo.dietPreference,
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
        }),
      });
      if (!aiRes.ok) {
        const data = (await aiRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          data.error ?? `Identification failed (HTTP ${aiRes.status})`,
        );
      }
      const result = (await aiRes.json()) as ResolvedMealPhoto;
      setMealPhotoResult(result);
    } catch (err) {
      setMealPlanMessage(
        err instanceof Error ? err.message : "Pair-capture handling failed.",
      );
    }
  };

  /** Append a list of FoodItems to a meal slot. Used by the
   *  MealPhotoReviewDialog after the user confirms the AI-identified
   *  foods. The FoodItems already have proper macros (the dialog
   *  scaled per-100g × user-adjusted grams), so we only need to
   *  re-mint ids to avoid collisions with other meal foods. */
  const handleBulkAddToMeal = (targetId: number, foods: FoodItem[]) => {
    let nextId = Date.now();
    const cloned = foods.map((f) => ({ ...f, id: nextId++ }));
    setMeals(
      meals.map((m) =>
        m.id === targetId ? { ...m, foods: [...m.foods, ...cloned] } : m,
      ),
    );
  };

  // local id so subsequent edits don't collide with the template's saved
  // foods or other meals' foods.
  const handleApplyTemplate = (template: MealTemplate) => {
    if (templateDialog?.kind !== "apply") return;
    const targetId = templateDialog.mealId;
    let nextId = freshIdSeed();
    const cloned: FoodItem[] = template.foods.map((f) => ({
      ...f,
      id: nextId++,
    }));

    // Same per-food attribution recipe Apply uses: each cloned food gets
    // its own `pantrySource` stamp so removal/edit restores its share,
    // and the matched pantry items draw down once each.
    const draws = planPerFoodConsumption(
      cloned.map((f) => ({ name: f.name, grams: f.portionSize })),
      pantryItems,
    );
    cloned.forEach((f, i) => {
      const d = draws[i];
      if (d) f.pantrySource = d;
    });

    setMeals(
      meals.map((m) =>
        m.id === targetId ? { ...m, foods: [...m.foods, ...cloned] } : m,
      ),
    );

    const drawByItem = new Map<string, number>();
    for (const d of draws) {
      if (d) {
        drawByItem.set(
          d.itemId,
          roundQuantity((drawByItem.get(d.itemId) ?? 0) + d.consumedQty),
        );
      }
    }
    for (const [itemId, qty] of drawByItem) applyPantryDelta(itemId, qty);
    if (drawByItem.size > 0) {
      toast.success(
        `Used ${drawByItem.size} pantry item${drawByItem.size === 1 ? "" : "s"}`,
      );
    }
  };

  /** Match a manually-added food to a pantry item and compute the
   *  draw-down. Returns the `pantrySource` stamp to store on the
   *  FoodItem (so edits/removal can adjust/restore it) plus the amount
   *  to subtract now — or null when the food isn't in the pantry or the
   *  item is already empty. `consumedQty` is capped at what's on hand so
   *  removal never restores more than was taken. */
  const planFoodDrawDown = (
    name: string,
    portionGrams: number,
  ): { itemId: string; consumedQty: number } | null => {
    const matched = matchPantryItem(name, pantryItems);
    if (!matched) return null;
    const want = consumedUnitAmount(
      matched.unit,
      portionGrams,
      1,
      matched.density,
    );
    const actual = Math.min(want, matched.quantity);
    if (actual <= 0) return null;
    return { itemId: matched.id, consumedQty: actual };
  };

  // Expand a recipe's ingredients into the target meal slot (today) as
  // individual FoodItems, drawing the pantry down. Converts RecipeIngredient
  // (per-100g snapshot + portionGrams) into the per-portion FoodItem shape;
  // afterwards each portion can be adjusted in the slot UI. Multi-day "cook for
  // the week" lives in the scheduler now (the Recipes Scheduled list), so this
  // is today-only.
  const handleApplyRecipe = (recipe: Recipe) => {
    if (applyRecipeMealId === null) return;
    const targetId = applyRecipeMealId;
    const targetSlot = meals.find((m) => m.id === targetId);
    if (!targetSlot) return;

    let nextId = Date.now();
    const foods = recipe.ingredients.map((ing) =>
      recipeIngredientToFood(ing, nextId++),
    );

    // Draw the recipe's ingredients down from the pantry, stamping each food's
    // source so a later remove/edit can restore it.
    const balance = new Map(
      pantryItems.map((i) => [i.id, i.quantity] as const),
    );
    const draws = planPerFoodConsumptionAgainstBalance(
      foods.map((f) => ({ name: f.name, grams: f.portionSize })),
      pantryItems,
      balance,
    );
    const drawByItem = new Map<string, number>();
    foods.forEach((f, i) => {
      const d = draws[i];
      if (d) {
        f.pantrySource = d;
        drawByItem.set(
          d.itemId,
          roundQuantity((drawByItem.get(d.itemId) ?? 0) + d.consumedQty),
        );
      }
    });

    setMeals(
      meals.map((m) =>
        m.id === targetId ? { ...m, foods: [...m.foods, ...foods] } : m,
      ),
    );
    for (const [itemId, qty] of drawByItem) applyPantryDelta(itemId, qty);
    if (drawByItem.size > 0) {
      toast.success(
        `Used ${drawByItem.size} pantry item${drawByItem.size === 1 ? "" : "s"}`,
      );
    }
    setApplyRecipeMealId(null);
  };

  // One-tap "log it" for a scheduled recipe: resolve the recipe (current
  // version) by id, scale it, and append to the chosen slot on today —
  // mirrors the today-only path of handleApplyRecipe (clone → pantry draw →
  // setMeals) without the meal-prep batch.
  const logScheduledRecipe = async (schedule: MealSchedule, mealId: number) => {
    const recipe = (await listRecipes()).find(
      (r) => r.id === schedule.recipeId,
    );
    if (!recipe) {
      toast.error("That recipe was removed — cancel the schedule in Recipes.");
      return;
    }
    const scaled = scaleRecipeIngredients(recipe.ingredients, schedule.scale);
    let nextId = Date.now();
    const foods = scaled.map((ing) => recipeIngredientToFood(ing, nextId++));
    const balance = new Map(
      pantryItems.map((i) => [i.id, i.quantity] as const),
    );
    const draws = planPerFoodConsumptionAgainstBalance(
      foods.map((f) => ({ name: f.name, grams: f.portionSize })),
      pantryItems,
      balance,
    );
    const drawByItem = new Map<string, number>();
    foods.forEach((f, i) => {
      const d = draws[i];
      if (d) {
        f.pantrySource = d;
        drawByItem.set(
          d.itemId,
          roundQuantity((drawByItem.get(d.itemId) ?? 0) + d.consumedQty),
        );
      }
    });
    setMeals(
      meals.map((m) =>
        m.id === mealId ? { ...m, foods: [...m.foods, ...foods] } : m,
      ),
    );
    for (const [itemId, qty] of drawByItem) applyPantryDelta(itemId, qty);
    toast.success(`Logged ${recipe.name}.`);
  };

  // "Log this day" from the suggester: apply each picked recipe to its slot on
  // today in ONE meals update (a per-pick setMeals would clobber the prior).
  // Pantry draws accumulate across the picks against a single running balance.
  const logSuggestedDay = (picks: { recipe: Recipe; mealId: number }[]) => {
    let nextId = Date.now();
    const balance = new Map(
      pantryItems.map((i) => [i.id, i.quantity] as const),
    );
    const drawByItem = new Map<string, number>();
    let updated = meals;
    for (const { recipe, mealId } of picks) {
      const foods = recipe.ingredients.map((ing) =>
        recipeIngredientToFood(ing, nextId++),
      );
      const draws = planPerFoodConsumptionAgainstBalance(
        foods.map((f) => ({ name: f.name, grams: f.portionSize })),
        pantryItems,
        balance,
      );
      foods.forEach((f, i) => {
        const d = draws[i];
        if (d) {
          f.pantrySource = d;
          drawByItem.set(
            d.itemId,
            roundQuantity((drawByItem.get(d.itemId) ?? 0) + d.consumedQty),
          );
        }
      });
      updated = updated.map((m) =>
        m.id === mealId ? { ...m, foods: [...m.foods, ...foods] } : m,
      );
    }
    setMeals(updated);
    for (const [itemId, qty] of drawByItem) applyPantryDelta(itemId, qty);
    toast.success(
      `Logged ${picks.length} meal${picks.length === 1 ? "" : "s"}.`,
    );
  };

  // Handle portion size change
  const handlePortionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = Number.parseFloat(e.target.value);
    const newSize = Number.isNaN(parsed) ? 0 : parsed;
    setPortionSize(newSize);
    if (selectedFood) {
      const ratio = newSize / 100;
      setNewFood({
        ...newFood,
        protein: Number.parseFloat((selectedFood.protein * ratio).toFixed(1)),
        carbs: Number.parseFloat((selectedFood.carbs * ratio).toFixed(1)),
        fat: Number.parseFloat((selectedFood.fat * ratio).toFixed(1)),
        calories: Math.round(selectedFood.calories * ratio),
      });
    }
  };

  // Handle new food input changes
  const handleFoodChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;

    if (name === "protein" || name === "carbs" || name === "fat") {
      // Automatically calculate calories when macros change
      const updatedFood = { ...newFood, [name]: Number.parseFloat(value) || 0 };
      const calories =
        updatedFood.protein * 4 + updatedFood.carbs * 4 + updatedFood.fat * 9;
      const roundedCalories = Math.round(calories);

      setNewFood({ ...updatedFood, calories: roundedCalories });

      // Re-base the picked food on a manual macro edit: keep `selectedFood` as
      // the authoritative per-100g basis (so a later portion change re-scales
      // the override instead of discarding it, recomputing from the now-stale
      // original) but STRIP catalog provenance — the numbers no longer match the
      // picked product, so the logged item must not carry its id/offCode/micros/
      // sub-macros. Scoped to an existing pick: a pure hand-typed entry keeps
      // `selectedFood` null, so its absolute values stay unscaled on re-portion
      // (today's behavior). Skip on a zero portion (no derivable per-100g).
      if (selectedFood && portionSize > 0) {
        const inv = 100 / portionSize;
        setSelectedFood({
          name: foodSearch.trim() || updatedFood.name,
          protein: updatedFood.protein * inv,
          carbs: updatedFood.carbs * inv,
          fat: updatedFood.fat * inv,
          calories: roundedCalories * inv,
        });
      }
    } else if (name === "calories") {
      setNewFood({ ...newFood, calories: Number.parseFloat(value) || 0 });
    } else {
      setNewFood({ ...newFood, [name]: value });
    }
  };

  // Append a food to a meal at an explicit portion — the SINGLE add path.
  // Search picks, quick-add, the desktop inline form, photo/voice/barcode all
  // funnel here. The per-100g → portion scaling (incl. sub-macros, unscaled
  // micros, offCode provenance, and the raw-per-100g `originalValues` snapshot)
  // lives in the pure `scaleFoodToItem`; this wrapper adds the stateful bits
  // (id, pantry draw-down, today-only `loggedAt`) and commits the write.
  const logFoodToMeal = (food: Food, mealId: number, grams: number) => {
    if (grams <= 0) return;
    // Draw the pantry down if this food matches an item on hand. Computed
    // before the meal write so the link (`pantrySource`) is stamped on the
    // FoodItem and a portion edit / removal can adjust / restore it.
    const drawDown = planFoodDrawDown(food.name, grams);
    const item: FoodItem = {
      id: Date.now(),
      ...scaleFoodToItem(food, grams),
      pantrySource: drawDown ?? undefined,
      // Real eating event → stamp the time, but only when logging to today
      // (back-filling a past day would record a wrong hour).
      loggedAt: selectedDate === today ? Date.now() : undefined,
    };
    setMeals(
      meals.map((meal) =>
        meal.id === mealId ? { ...meal, foods: [...meal.foods, item] } : meal,
      ),
    );
    if (drawDown) applyPantryDelta(drawDown.itemId, drawDown.consumedQty);
    signalMealLogged(mealId);
  };

  // One-tap quick-log from the guided launcher's recents list. Logs, then
  // confirms with the canonical toast. The toast lives HERE (not in
  // `logFoodToMeal`) on purpose: the barcode/photo path toasts on its own, so
  // a toast inside the shared helper would double-fire there. The full-screen
  // search sheet likewise owns its own toast — this wrapper is only for the
  // launcher's recents tap, the one add surface that had NO feedback.
  const quickLogFood = (food: Food, mealId: number, grams: number) => {
    logFoodToMeal(food, mealId, grams);
    const dest = meals.find((m) => m.id === mealId);
    if (!dest) return;
    const kcal = Math.round((food.calories * grams) / 100);
    toast.success(addedFoodMessage(food.name, grams, kcal, dest.name));
  };

  // Add the desktop inline form's current food to its target meal. Resolves the
  // per-100g basis from the form state (`addFoodBasis` keeps a picked food
  // verbatim — full precision + provenance — and only folds back to per-100g on
  // a genuine manual override) and delegates to the one `logFoodToMeal` path, so
  // a desktop add is identical to a mobile/search add.
  // Returns whether a food was actually logged, so the inline form only
  // confirms with a toast on a real write — a blank name or a zero/blank
  // portion is a silent no-op, not a phantom "Added (0 g)" toast.
  const addFood = (): boolean => {
    const name = foodSearch.trim();
    if (name === "") return false;
    if (portionSize <= 0) return false;
    const mealId = Number.parseInt(newFood.selectedMealId?.toString() || "0");
    const basis = addFoodBasis(selectedFood, newFood, name, portionSize);
    logFoodToMeal(basis, mealId, portionSize);

    // Reset the inline form for the next add.
    setNewFood({
      id: 0,
      name: "",
      protein: 0,
      carbs: 0,
      fat: 0,
      calories: 0,
      portionSize: 0,
      selectedMealId: newFood.selectedMealId,
    });
    setFoodSearch("");
    setPortionSize(100);
    setSelectedFood(null);
    return true;
  };

  /** Copy a previous day's meal slot into `targetMealId` — append all its
   *  foods (with fresh ids) in one write, drawing the pantry down per food.
   *  A single batch `setMeals` (not a per-food loop) keeps it consistent with
   *  the value-only `setMeals` setter. */
  const copyMealItems = (targetMealId: number, items: FoodItem[]) => {
    if (items.length === 0) return;
    const now = Date.now();
    const drawByItem = new Map<string, number>();
    const cloned: FoodItem[] = items.map((it, i) => {
      const drawDown = planFoodDrawDown(it.name, it.portionSize);
      if (drawDown) {
        drawByItem.set(
          drawDown.itemId,
          (drawByItem.get(drawDown.itemId) ?? 0) + drawDown.consumedQty,
        );
      }
      return {
        ...it,
        id: now + i,
        selectedMealId: targetMealId,
        pantrySource: drawDown ?? undefined,
        // Copying a past meal into today is a real "I'm eating this" action
        // → stamp now (overwriting the source's loggedAt). Gated to today.
        loggedAt: selectedDate === today ? now : undefined,
      };
    });
    setMeals(
      meals.map((meal) =>
        meal.id === targetMealId
          ? { ...meal, foods: [...meal.foods, ...cloned] }
          : meal,
      ),
    );
    for (const [itemId, qty] of drawByItem) applyPantryDelta(itemId, qty);
    signalMealLogged(targetMealId);
    const dest = meals.find((m) => m.id === targetMealId);
    toast.success(
      `Copied ${cloned.length} food${cloned.length === 1 ? "" : "s"} to ${
        dest?.name ?? "meal"
      }`,
    );
  };

  // Expand a recipe into a single meal — the "Log meal" sheet's recipe
  // path. A focused, single-day version of handleApplyRecipe (no
  // meal-prep batch): clone each ingredient into a per-portion FoodItem,
  // Dispatch a guided "Log meal" method to its full-screen tool, each
  // pre-targeted to the meal the user chose in the launcher. Recipe and
  // template reuse the existing full pickers; barcode/photo/voice route
  // back to the target meal via `logTargetMealId`.
  const handleLogMethod = (method: LogMethod, mealId: number) => {
    setLogMealOpen(false);
    // Remember the meal so each tool can offer "Back" to the method step.
    setLogFlowMealId(mealId);
    switch (method) {
      case "search":
        setLogTargetMealId(mealId);
        setFoodSearchOpen(true);
        break;
      case "recipe":
        setApplyRecipeMealId(mealId);
        break;
      case "template":
        setTemplateDialog({ kind: "apply", mealId });
        break;
      case "barcode":
        setLogTargetMealId(mealId);
        setCameraMode("scan");
        setCameraSheetOpen(true);
        break;
      case "photo":
        setLogTargetMealId(mealId);
        setCameraMode("photo");
        setCameraSheetOpen(true);
        break;
      case "voice":
        setLogTargetMealId(mealId);
        setVoiceSheetOpen(true);
        break;
    }
  };

  // A tool's "Back": close it and reopen the launcher at the method step
  // for the same meal (`logFlowMealId` seeds the launcher's initial meal).
  const backToMethod = () => {
    setFoodSearchOpen(false);
    setApplyRecipeMealId(null);
    setTemplateDialog(null);
    setCameraSheetOpen(false);
    setVoiceSheetOpen(false);
    setLogMealOpen(true);
  };

  /** Shared Undo-restore plumbing. The toast outlives day navigation and meal
   *  ids repeat across days (DEFAULT_MEALS 1–4), so a bare setMeals would land
   *  the foods on whichever day is selected when Undo is tapped — or be
   *  clobbered mid day-switch by the hook's load effect. While the captured
   *  day is still displayed AND hydrated, restore in memory (keeps edits the
   *  500 ms write debounce hasn't flushed); otherwise write straight to that
   *  date's IDB row — saveDailyLog's data-bus notify re-hydrates the hook if
   *  the user switches back. Pantry re-draws only after the restore lands. */
  const restoreIntoDay = (
    date: string,
    patch: (meals: Meal[]) => Meal[],
    pantryDraws: FoodItem[],
  ) => {
    const redraw = () => {
      for (const f of pantryDraws) {
        if (f.pantrySource) {
          applyPantryDelta(f.pantrySource.itemId, f.pantrySource.consumedQty);
        }
      }
    };
    if (date === selectedDateRef.current && dayHydratedRef.current) {
      setMeals(patch(mealsRef.current));
      redraw();
      return;
    }
    void (async () => {
      try {
        const log = await getDailyLog(date);
        await saveDailyLog(date, patch(log?.meals ?? DEFAULT_MEALS));
        bumpPending();
        redraw();
      } catch (err) {
        reportStorageError(err);
        toast.error("Couldn't undo. Try again.");
      }
    })();
  };

  /** Re-add every food cleared from a meal and re-draw their pantry links —
   *  the Undo path for `clearMeal`. */
  const restoreClearedMeal = (
    date: string,
    mealId: number,
    foods: FoodItem[],
  ) => {
    restoreIntoDay(
      date,
      (ms) =>
        ms.map((m) =>
          m.id === mealId ? { ...m, foods: [...m.foods, ...foods] } : m,
        ),
      foods,
    );
  };

  // Clear every food from a meal in one go (the meal's "Clear meal" menu
  // action), giving back any pantry draw-downs — with an Undo toast that
  // restores the foods and their draws, mirroring single-food removal.
  const clearMeal = (mealId: number) => {
    const meal = meals.find((m) => m.id === mealId);
    if (!meal || meal.foods.length === 0) return;
    haptic("warning");
    const cleared = meal.foods;
    setMeals(meals.map((m) => (m.id === mealId ? { ...m, foods: [] } : m)));
    for (const f of cleared) {
      if (f.pantrySource) {
        applyPantryDelta(f.pantrySource.itemId, -f.pantrySource.consumedQty);
      }
    }
    toast(`Cleared ${meal.name}`, {
      action: {
        label: "Undo",
        onClick: () => restoreClearedMeal(selectedDate, mealId, cleared),
      },
    });
  };

  /** Re-insert an undone food at its original position (clamped) on the day
   *  it was removed from — the Undo path for `removeFood`. */
  const restoreRemovedFood = (
    date: string,
    mealId: number,
    food: FoodItem,
    index: number,
  ) => {
    restoreIntoDay(
      date,
      (ms) =>
        ms.map((m) => {
          if (m.id !== mealId) return m;
          const at = Math.max(0, Math.min(index, m.foods.length));
          return {
            ...m,
            foods: [...m.foods.slice(0, at), food, ...m.foods.slice(at)],
          };
        }),
      [food],
    );
  };

  // Remove a food from a meal, with an Undo toast — instant-with-recovery on
  // desktop and mobile alike, so a mis-tap is never silent data loss.
  const removeFood = (mealId: number, foodId: number) => {
    const meal = meals.find((m) => m.id === mealId);
    const index = meal?.foods.findIndex((f) => f.id === foodId) ?? -1;
    const removed = index >= 0 ? meal?.foods[index] : undefined;
    if (!removed) return;

    setMeals(
      meals.map((m) =>
        m.id === mealId
          ? { ...m, foods: m.foods.filter((f) => f.id !== foodId) }
          : m,
      ),
    );
    // If the food drew from the pantry, give the quantity back.
    if (removed.pantrySource) {
      applyPantryDelta(
        removed.pantrySource.itemId,
        -removed.pantrySource.consumedQty,
      );
    }

    toast(`Removed ${removed.name}`, {
      action: {
        label: "Undo",
        onClick: () => restoreRemovedFood(selectedDate, mealId, removed, index),
      },
    });
  };

  /** Duplicate a logged food within its meal — the "I ate two of
   *  these" shortcut (double-tap on touch). Mints a fresh id so the
   *  copy is independently editable / removable, and re-draws the
   *  pantry if the original was linked to an item on hand (eating a
   *  second portion consumes a second portion). Inserts the copy
   *  right after the original so it reads as a pair. */
  const duplicateFood = (mealId: number, foodId: number) => {
    const source = meals
      .find((m) => m.id === mealId)
      ?.foods.find((f) => f.id === foodId);
    if (!source) return;
    // Re-plan the pantry draw for the duplicate from the source's
    // name + portion, so the copy carries its own restorable link.
    const drawDown = planFoodDrawDown(source.name, source.portionSize);
    const copy: FoodItem = {
      ...source,
      id: Date.now() + Math.random(),
      pantrySource: drawDown ?? undefined,
    };
    const updatedMeals = meals.map((meal) => {
      if (meal.id !== mealId) return meal;
      const idx = meal.foods.findIndex((f) => f.id === foodId);
      const foods = [...meal.foods];
      foods.splice(idx + 1, 0, copy);
      return { ...meal, foods };
    });
    setMeals(updatedMeals);
    if (drawDown) applyPantryDelta(drawDown.itemId, drawDown.consumedQty);
  };

  // Drag-and-drop: move a food to a different meal, optionally to a
  // specific index. When `destIndex` is omitted, the food lands at the
  // end of the destination meal. Within-meal moves with the same index
  // are a no-op (avoids spurious setMeals on accidental clicks).
  const moveFood = (
    srcMealId: number,
    destMealId: number,
    foodId: number,
    destIndex?: number,
  ) => {
    const src = meals.find((m) => m.id === srcMealId);
    if (!src) return;
    const food = src.foods.find((f) => f.id === foodId);
    if (!food) return;

    const sameMeal = srcMealId === destMealId;
    const fromIndex = src.foods.findIndex((f) => f.id === foodId);
    if (sameMeal && (destIndex === undefined || destIndex === fromIndex)) {
      return;
    }

    setMeals(
      meals.map((meal) => {
        if (sameMeal && meal.id === srcMealId) {
          const next = src.foods.filter((f) => f.id !== foodId);
          const insertAt = Math.min(destIndex ?? next.length, next.length);
          next.splice(insertAt, 0, food);
          return { ...meal, foods: next };
        }
        if (meal.id === srcMealId) {
          return { ...meal, foods: meal.foods.filter((f) => f.id !== foodId) };
        }
        if (meal.id === destMealId) {
          const next = [...meal.foods];
          const insertAt = Math.min(destIndex ?? next.length, next.length);
          next.splice(insertAt, 0, food);
          return { ...meal, foods: next };
        }
        return meal;
      }),
    );
  };

  // Start editing a food's portion size
  const startEditingFood = (mealId: number, food: FoodItem) => {
    setEditingFood({
      mealId,
      foodId: food.id,
      portionSize: food.portionSize,
      originalFood: food,
    });
  };

  // Cancel editing
  const cancelEditing = () => {
    setEditingFood({
      mealId: null,
      foodId: null,
      portionSize: 0,
      originalFood: null,
    });
  };

  // Handle portion size change during editing
  const handleEditPortionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newSize = Math.max(1, Number.parseInt(e.target.value) || 0);
    setEditingFood({ ...editingFood, portionSize: newSize });
  };

  // Save edited portion size
  const saveEditedPortion = () => {
    const originalFood = editingFood.originalFood;
    if (!originalFood) return;

    // Prefer the per-100g values captured at add-time (works for builtin,
    // custom, and OFF foods). Fall back to a builtin lookup for legacy
    // entries that pre-date the originalValues capture.
    let proteinPer100g: number | undefined;
    let carbsPer100g: number | undefined;
    let fatPer100g: number | undefined;
    let caloriesPer100g: number | undefined;
    if (originalFood.originalValues) {
      ({ proteinPer100g, carbsPer100g, fatPer100g, caloriesPer100g } =
        originalFood.originalValues);
    } else {
      const dbFood = foodDatabase.find((f) => f.name === originalFood.name);
      if (!dbFood) {
        cancelEditing();
        return;
      }
      proteinPer100g = dbFood.protein;
      carbsPer100g = dbFood.carbs;
      fatPer100g = dbFood.fat;
      caloriesPer100g = dbFood.calories;
    }

    // Re-scale the pantry draw-down to the new portion. The matched
    // item's live quantity already had the OLD draw-down subtracted, so
    // we apply only the delta; the new draw-down is capped at what would
    // be on hand if the old amount were restored, and `pantrySource`
    // updates to the new amount.
    let nextPantrySource = originalFood.pantrySource;
    if (originalFood.pantrySource) {
      const item = pantryItems.find(
        (i) => i.id === originalFood.pantrySource?.itemId,
      );
      if (item) {
        const oldConsumed = originalFood.pantrySource.consumedQty;
        const want = consumedUnitAmount(
          item.unit,
          editingFood.portionSize,
          1,
          item.density,
        );
        const actualNew = Math.min(want, item.quantity + oldConsumed);
        const delta = roundQuantity(actualNew - oldConsumed);
        if (delta !== 0) applyPantryDelta(item.id, delta);
        nextPantrySource = { itemId: item.id, consumedQty: actualNew };
      } else {
        // The pantry item this food was drawn from has been deleted
        // since the log was written. Drop the stale stamp so future
        // edits / removals don't try to resolve a dead id — the
        // original draw is unrecoverable at this point regardless,
        // since the item it referenced no longer exists.
        nextPantrySource = undefined;
      }
    }

    // Re-scale the 4 mains from the per-100g basis AND the MacroBreakdown
    // sub-macros by the portion ratio. Previously the sub-macros (fiber,
    // saturatedFat, sugars, …) were carried over via `...originalFood`
    // unchanged, so a portion edit left them frozen at the old portion — which
    // could make sat-fat exceed total fat and inflate the meal-insights fiber.
    const updatedFood = {
      ...originalFood,
      portionSize: editingFood.portionSize,
      ...rescaleFoodMacros(originalFood, editingFood.portionSize, {
        protein: proteinPer100g,
        carbs: carbsPer100g,
        fat: fatPer100g,
        calories: caloriesPer100g,
      }),
      pantrySource: nextPantrySource,
    };

    // Update the food in the meal
    const updatedMeals = meals.map((meal) => {
      if (meal.id === editingFood.mealId) {
        return {
          ...meal,
          foods: meal.foods.map((food) =>
            food.id === editingFood.foodId ? updatedFood : food,
          ),
        };
      }
      return meal;
    });

    setMeals(updatedMeals);
    cancelEditing();
  };

  // Start replacing a food
  const startReplacingFood = (mealId: number, food: FoodItem) => {
    setReplacingFood({
      mealId,
      foodId: food.id,
      portionSize: food.portionSize,
      searchTerm: "",
      suggestions: [],
      showSuggestions: false,
    });
  };

  // Cancel replacing
  const cancelReplacing = () => {
    setReplacingFood({
      mealId: null,
      foodId: null,
      portionSize: 0,
      searchTerm: "",
      suggestions: [],
      showSuggestions: false,
    });
  };

  // Handle food search for replacement. This only tracks the query string;
  // the actual results come from the shared `replaceSearch` (useFoodSearch)
  // and are merged into the `replacingFood` view passed to the meal rows.
  const handleReplacementSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setReplacingFood((prev) => ({ ...prev, searchTerm: e.target.value }));
  };

  // Replace a food with a new one
  const replaceFood = (newFood: Food) => {
    // Calculate the ratio based on the portion size
    const ratio = replacingFood.portionSize / 100;

    // Restore the outgoing food's pantry draw-down, then draw down for
    // the incoming food if it matches an item on hand.
    const outgoing = meals
      .find((m) => m.id === replacingFood.mealId)
      ?.foods.find((f) => f.id === replacingFood.foodId);
    const newDrawDown = planFoodDrawDown(
      newFood.name,
      replacingFood.portionSize,
    );

    // Create new food object with calculated macros
    const replacementFood = {
      id: Date.now() + Math.random(),
      name: newFood.name,
      protein: Number.parseFloat((newFood.protein * ratio).toFixed(1)),
      carbs: Number.parseFloat((newFood.carbs * ratio).toFixed(1)),
      fat: Number.parseFloat((newFood.fat * ratio).toFixed(1)),
      calories: Math.round(newFood.calories * ratio),
      portionSize: replacingFood.portionSize,
      category: newFood.category,
      subCategory: newFood.subCategory,
      // Scale the sub-macros (sugars / saturated fat / fiber …) to the portion,
      // the same way the add path does — otherwise a replaced food keeps no
      // sub-macro breakdown.
      ...scaleSubMacros(newFood, ratio),
      pantrySource: newDrawDown ?? undefined,
      // Carry per-100g micronutrients onto the replacement (unscaled —
      // the aggregator scales). `newFood` here is the replacement Food.
      micronutrients: newFood.micronutrients,
      offCode: offCodeFromFoodId(newFood.id),
      originalValues: {
        proteinPer100g: newFood.protein,
        carbsPer100g: newFood.carbs,
        fatPer100g: newFood.fat,
        caloriesPer100g: newFood.calories,
      },
    };

    // Update meals state by replacing the old food with the new one
    const updatedMeals = meals.map((meal) => {
      if (meal.id === replacingFood.mealId) {
        return {
          ...meal,
          foods: meal.foods.map((food) =>
            food.id === replacingFood.foodId ? replacementFood : food,
          ),
        };
      }
      return meal;
    });

    setMeals(updatedMeals);
    if (outgoing?.pantrySource) {
      applyPantryDelta(
        outgoing.pantrySource.itemId,
        -outgoing.pantrySource.consumedQty,
      );
    }
    if (newDrawDown)
      applyPantryDelta(newDrawDown.itemId, newDrawDown.consumedQty);
    cancelReplacing();
  };

  // Generate a full day meal plan that hits the daily macro targets.
  // Try the AI route first (when configured + user signed in) for more
  // coherent food combinations; fall back to the deterministic 3×3
  // Cramer-based planner on any failure path - see lib/meal-planner.ts.
  const generateMealPlan = async () => {
    setIsGeneratingMealPlan(true);
    setCoherenceIssues([]);
    setMealPlanMessage("Generating your personalized meal plan...");
    try {
      // Pull saved custom foods (silent if IndexedDB is unavailable).
      let customFoods: Food[] = [];
      try {
        const rows = await listCustomFoods();
        customFoods = rows.map(customToFood);
      } catch {
        // Fine - proceed with builtin only.
      }

      const daily = {
        protein: calculatedValues.protein,
        carbs: calculatedValues.carbs,
        fat: calculatedValues.fat,
        calories: calculatedValues.targetCalories,
      };

      // Pull the soft-bias signals (recent rotation + pantry on hand)
      // the server bakes into the system prompt so plans pick from
      // the user's universe / available ingredients instead of stock
      // picks. Failure-tolerant — never blocks generation.
      const { recentlyEatenFoods, pantryItems: aiPantryBias } =
        await loadAiBiasSignals();

      // Try the AI route first. Errors here are non-fatal - they fall
      // through to the deterministic planner below.
      const ai = await requestAiMealPlan({
        targets: daily,
        dietPreference: personalInfo.dietPreference,
        mealNames: meals.map((m) => m.name),
        customFoods,
        cuisinePreferences: personalInfo.cuisinePreferences ?? [],
        allergies: personalInfo.allergies ?? [],
        dislikedFoods: personalInfo.dislikedFoods ?? [],
        recentlyEatenFoods,
        pantryItems: aiPantryBias,
        market: getMarket(),
      });

      if (ai.kind === "ok") {
        // Stamp pantrySource on each new food + net the delta against
        // whatever the old plan had drawn — same pattern as Apply
        // recipe, so editing or removing an auto-filled food restores
        // its share, and replacing a logged plan doesn't leak its old
        // draws.
        const netByItem = replanPantryDeltas(meals, ai.meals, pantryItems);
        setMeals(ai.meals);
        for (const [id, net] of netByItem) applyPantryDelta(id, net);
        setCoherenceIssues(ai.coherenceIssues ?? []);
        const summary = summarisePlan(ai.meals, daily);
        const fmt = (n: number) => `${Math.round(n)}%`;
        setMealPlanMessage(
          `AI plan - P:${fmt(summary.percent.protein)} C:${fmt(summary.percent.carbs)} F:${fmt(summary.percent.fat)} of target.`,
        );
        setTimeout(() => setMealPlanMessage(""), 5000);
        return;
      }

      // Auth and cap failures are GATES, not fallback cases: silently
      // filling the day with the formula planner would hand a guest (or a
      // capped free user) the feature the gate protects, behind an
      // AI-labelled button. Leave the day untouched and open the proper
      // modal — sign-in prompt or the upgrade dialog — instead of a toast
      // that vanishes before it's read.
      if (ai.kind === "not-authenticated") {
        setMealPlanMessage("");
        setSignInPromptFeature("AI meal planning");
        return;
      }
      if (ai.kind === "cap-reached") {
        setMealPlanMessage("");
        setCapUpgradeOpen(true);
        return;
      }

      // The remaining kinds are availability problems (no key configured,
      // upstream rate-limit, transient failure) — there the deterministic
      // formula planner is genuine resilience, clearly labelled as such.

      // Yield once so the spinner paints before the synchronous solve.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const planned = planDay(meals, foodDatabase, daily, {
        customFoods,
        dietPreference: personalInfo.dietPreference,
      });
      const summary = summarisePlan(planned, daily);

      const fallbackNet = replanPantryDeltas(meals, planned, pantryItems);
      setMeals(planned);
      for (const [id, net] of fallbackNet) applyPantryDelta(id, net);

      const fmt = (n: number) => `${Math.round(n)}%`;
      // Lead the message with the *reason* AI was skipped - silent
      // fallback is confusing if the user expected the AI to fire.
      const prefix =
        ai.kind === "not-configured"
          ? "AI not configured - used formula. "
          : ai.kind === "rate-limited"
            ? "AI rate-limited - used formula. "
            : ai.kind === "error"
              ? `AI failed (${ai.message}) - used formula. `
              : "";
      const tail = summary.withinTolerance
        ? `Plan hits P:${fmt(summary.percent.protein)} C:${fmt(summary.percent.carbs)} F:${fmt(summary.percent.fat)} of target.`
        : `Plan within reach - P:${fmt(summary.percent.protein)} C:${fmt(summary.percent.carbs)} F:${fmt(summary.percent.fat)}. Limited by available foods.`;
      setMealPlanMessage(prefix + tail);
      setTimeout(() => setMealPlanMessage(""), 6000);
    } catch (error) {
      setMealPlanMessage("Error generating meal plan. Please try again.");
      console.error("Meal plan generation error:", error);
    } finally {
      setIsGeneratingMealPlan(false);
    }
  };

  /** Apply a one-shot refinement (from a refiner pill) to the current
   *  meal plan. Shares the `isGeneratingMealPlan` busy state with the
   *  Auto-fill button - only one AI call is in flight at a time, which
   *  the route also guards by being non-reentrant. Failures surface in
   *  `mealPlanMessage`; the existing meals are left untouched on
   *  error. */
  const handleRefineMealPlan = async (refinement: string) => {
    if (isGeneratingMealPlan) return;
    setIsGeneratingMealPlan(true);
    setCoherenceIssues([]);
    setMealPlanMessage("Refining your meal plan…");
    try {
      let customFoods: Food[] = [];
      try {
        const rows = await listCustomFoods();
        customFoods = rows.map(customToFood);
      } catch {
        // Proceed with builtins only.
      }
      const daily = {
        protein: calculatedValues.protein,
        carbs: calculatedValues.carbs,
        fat: calculatedValues.fat,
        calories: calculatedValues.targetCalories,
      };
      const { recentlyEatenFoods, pantryItems: aiPantryBias } =
        await loadAiBiasSignals();
      const ai = await requestAiMealPlan({
        targets: daily,
        dietPreference: personalInfo.dietPreference,
        mealNames: meals.map((m) => m.name),
        customFoods,
        cuisinePreferences: personalInfo.cuisinePreferences ?? [],
        allergies: personalInfo.allergies ?? [],
        dislikedFoods: personalInfo.dislikedFoods ?? [],
        refinement,
        previousMeals: meals,
        recentlyEatenFoods,
        pantryItems: aiPantryBias,
        market: getMarket(),
      });
      if (ai.kind === "ok") {
        const netByItem = replanPantryDeltas(meals, ai.meals, pantryItems);
        setMeals(ai.meals);
        for (const [id, net] of netByItem) applyPantryDelta(id, net);
        setCoherenceIssues(ai.coherenceIssues ?? []);
        const summary = summarisePlan(ai.meals, daily);
        const fmt = (n: number) => `${Math.round(n)}%`;
        setMealPlanMessage(
          `Refined - P:${fmt(summary.percent.protein)} C:${fmt(summary.percent.carbs)} F:${fmt(summary.percent.fat)} of target.`,
        );
        setTimeout(() => setMealPlanMessage(""), 5000);
        return;
      }
      // Unlike Auto-fill, we don't fall back to the deterministic
      // planner for refinements - it has no notion of free-text
      // constraints. Auth/cap gates open their proper modals; the
      // availability failures surface in the banner, plan untouched.
      if (ai.kind === "not-authenticated") {
        setMealPlanMessage("");
        setSignInPromptFeature("AI refinements");
        return;
      }
      if (ai.kind === "cap-reached") {
        setMealPlanMessage("");
        setCapUpgradeOpen(true);
        return;
      }
      const msg =
        ai.kind === "not-configured"
          ? "AI not configured - refinement skipped."
          : ai.kind === "rate-limited"
            ? "AI rate-limited - try again shortly."
            : ai.kind === "error"
              ? `Refinement failed: ${ai.message}`
              : "Refinement failed.";
      setMealPlanMessage(msg);
    } catch (error) {
      setMealPlanMessage("Error refining meal plan. Please try again.");
      console.error("Meal plan refinement error:", error);
    } finally {
      setIsGeneratingMealPlan(false);
    }
  };

  /** Per-meal regeneration - the user clicks the sparkles button on a
   *  single meal slot. The AI returns ONLY that meal (with name set to
   *  the slot's name); we replace just that slot's foods. The rest of
   *  the day's meals are passed as context so the AI doesn't propose
   *  something culinarily clashing with what's around it. */
  const handleRegenerateMeal = async (mealId: number) => {
    if (isGeneratingMealPlan) return;
    const target = meals.find((m) => m.id === mealId);
    if (!target) return;
    setIsGeneratingMealPlan(true);
    setGeneratingMealId(mealId);
    // The global banner is preserved as an accessibility / screen-
    // reader cue and as a fallback when the user is scrolled away
    // from the affected meal slot. Per-meal visual indicator (spinner
    // + "Generating…" inline) is the primary feedback now.
    const verb = target.foods.length === 0 ? "Generating" : "Regenerating";
    setMealPlanMessage(`${verb} ${target.name}…`);
    try {
      let customFoods: Food[] = [];
      try {
        const rows = await listCustomFoods();
        customFoods = rows.map(customToFood);
      } catch {
        // Proceed with builtins only.
      }
      const daily = {
        protein: calculatedValues.protein,
        carbs: calculatedValues.carbs,
        fat: calculatedValues.fat,
        calories: calculatedValues.targetCalories,
      };
      const { recentlyEatenFoods, pantryItems: aiPantryBias } =
        await loadAiBiasSignals();
      const ai = await requestAiMealPlan({
        targets: daily,
        dietPreference: personalInfo.dietPreference,
        mealNames: meals.map((m) => m.name),
        customFoods,
        cuisinePreferences: personalInfo.cuisinePreferences ?? [],
        allergies: personalInfo.allergies ?? [],
        dislikedFoods: personalInfo.dislikedFoods ?? [],
        previousMeals: meals,
        targetMealName: target.name,
        recentlyEatenFoods,
        pantryItems: aiPantryBias,
        market: getMarket(),
      });
      if (ai.kind === "ok") {
        // The AI was told to return exactly one meal. Match by name
        // (case-insensitive) so a stray model quirk doesn't drop the
        // payload. If for some reason multiple meals came back, take
        // the first one matching the target.
        const replacement = ai.meals.find(
          (m) => m.name.toLowerCase() === target.name.toLowerCase(),
        );
        if (replacement) {
          const pastVerb =
            target.foods.length === 0 ? "Generated" : "Regenerated";
          // Single-meal regenerate: restore the old slot's draws and
          // attribute the new ones. Pass single-meal arrays so the
          // helper only nets this slot, not the whole day.
          const newSlot: Meal = {
            id: target.id,
            name: target.name,
            foods: replacement.foods,
          };
          const netByItem = replanPantryDeltas(
            [target],
            [newSlot],
            pantryItems,
          );
          setMeals(meals.map((m) => (m.id === target.id ? newSlot : m)));
          for (const [id, net] of netByItem) applyPantryDelta(id, net);
          // The route skips coherence validation on single-meal mode
          // (low-day-protein and friends would always fire on a single
          // slot in isolation), so the response can't carry NEW issues
          // for this slot. But the OLD issues for this slot are now
          // stale — the foods changed. Drop them so the warning chip
          // disappears immediately on success.
          setCoherenceIssues((prev) =>
            prev.filter((i) => i.mealName !== target.name),
          );
          setMealPlanMessage(`${pastVerb} ${target.name}.`);
          setTimeout(() => setMealPlanMessage(""), 4000);
          return;
        }
        setMealPlanMessage(
          `AI didn't return a ${target.name} meal - try again.`,
        );
        return;
      }
      const action = target.foods.length === 0 ? "Generation" : "Regeneration";
      if (ai.kind === "not-authenticated") {
        setMealPlanMessage("");
        setSignInPromptFeature(`AI meal ${action.toLowerCase()}`);
        return;
      }
      if (ai.kind === "cap-reached") {
        setMealPlanMessage("");
        setCapUpgradeOpen(true);
        return;
      }
      const msg =
        ai.kind === "not-configured"
          ? `AI not configured - ${action.toLowerCase()} skipped.`
          : ai.kind === "rate-limited"
            ? "AI rate-limited - try again shortly."
            : ai.kind === "error"
              ? `${action} failed: ${ai.message}`
              : `${action} failed.`;
      setMealPlanMessage(msg);
    } catch (error) {
      setMealPlanMessage(`Error regenerating ${target.name}. Try again.`);
      console.error("Meal regeneration error:", error);
    } finally {
      setIsGeneratingMealPlan(false);
      setGeneratingMealId(null);
    }
  };

  return (
    <AppShell
      current={view}
      onSelect={setView}
    >
      {view === "calculator" && (
        <div className="space-y-6">
          <BodySummaryStrip
            personalInfo={personalInfo}
            today={today}
            onEdit={() => setView("profile")}
          />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            {/* Left: the inputs you set, in goal order — diet/activity, then
                the goal, then the goal-phase plan that continues it. */}
            <div className="space-y-6 lg:col-span-3">
              <PersonalInfoForm
                personalInfo={personalInfo}
                onPersonalInfoChange={handlePersonalInfoChange}
              />
              <GoalPhasesPlanner
                phases={personalInfo.goalPhases}
                onChange={(next) => patchProfile("goalPhases", next)}
                weightKg={personalInfo.weight}
                units={personalInfo.units}
                today={today}
                goal={personalInfo.goal}
                targetForPhases={targetForPhases}
              />
            </div>
            {/* Right: the computed targets and the Advanced overrides that
                feed straight into them. */}
            <div className="space-y-6 lg:col-span-2">
              <MacroResults
                calculatedValues={calculatedValues}
                totalMacros={totalMacros}
                units={personalInfo.units}
              />
              <AdvancedSettingsSection
                personalInfo={personalInfo}
                onPersonalInfoChange={handlePersonalInfoChange}
              />
            </div>
          </div>
        </div>
      )}

      {view === "profile" && (
        <ProfileView
          personalInfo={personalInfo}
          onPersonalInfoChange={handlePersonalInfoChange}
          today={today}
          onSelectView={setView}
        />
      )}

      {view === "plan" && (
        <MealPlanner
          calculatedValues={calculatedValues}
          totalMacros={totalMacros}
          macroBreakdown={macroBreakdown}
          meals={meals}
          dayHydrated={dayHydrated}
          selectedDate={selectedDate}
          today={today}
          mealSchedules={mealSchedules}
          onLogScheduled={logScheduledRecipe}
          onOpenSuggestDay={() => setSuggestDayOpen(true)}
          waterGoalMl={waterGoalMl(personalInfo)}
          units={personalInfo.units}
          goalPhase={activeGoalPhase}
          goalPhaseNudge={goalPhaseNudge}
          onSelectView={setView}
          onSelectDate={(d) => setExplicitDate(d === today ? null : d)}
          newFood={newFood}
          foodSearch={foodSearch}
          foodSuggestions={foodSuggestions}
          pantryItems={pantryItems}
          showSuggestions={showSuggestions}
          isSearchingRemote={search.isSearchingRemote}
          portionSize={portionSize}
          isGeneratingMealPlan={isGeneratingMealPlan}
          generatingMealId={generatingMealId}
          mealPlanMessage={mealPlanMessage}
          coherenceIssues={coherenceIssues}
          editingFood={editingFood}
          replacingFood={{
            ...replacingFood,
            // Live results from the shared multi-source search; the row shows
            // them when there's a query and at least one match.
            suggestions: replaceSearch.results,
            showSuggestions: replacingFood.searchTerm.trim() !== "",
          }}
          suggestionsRef={suggestionsRef}
          replacementSuggestionsRef={replacementSuggestionsRef}
          setNewFood={setNewFood}
          setFoodSearch={setFoodSearch}
          setPortionSize={setPortionSize}
          handleFoodSearch={handleFoodSearch}
          handleFoodSelect={handleFoodSelect}
          handlePortionChange={handlePortionChange}
          handleFoodChange={handleFoodChange}
          addFood={addFood}
          onQuickLog={quickLogFood}
          removeFood={removeFood}
          duplicateFood={duplicateFood}
          moveFood={moveFood}
          startEditingFood={startEditingFood}
          cancelEditing={cancelEditing}
          handleEditPortionChange={handleEditPortionChange}
          saveEditedPortion={saveEditedPortion}
          startReplacingFood={startReplacingFood}
          cancelReplacing={cancelReplacing}
          handleReplacementSearch={handleReplacementSearch}
          replaceFood={replaceFood}
          generateMealPlan={generateMealPlan}
          onRefineMealPlan={handleRefineMealPlan}
          onRegenerateMeal={handleRegenerateMeal}
          onSaveOffToCustom={handleSaveOffToCustom}
          onOpenCustomFoodForm={() => setCustomFoodOpen(true)}
          onOpenCamera={() => {
            // Desktop inline Scan: clear any guided target so a scanned
            // barcode seeds the inline form (visible on desktop) and no
            // "Back to method" appears.
            setLogTargetMealId(null);
            setLogFlowMealId(null);
            setCameraMode("scan");
            setCameraSheetOpen(true);
          }}
          onOpenVoice={
            user
              ? () => {
                  setLogTargetMealId(null);
                  setLogFlowMealId(null);
                  setVoiceSheetOpen(true);
                }
              : undefined
          }
          onSaveAsTemplate={(mealId) =>
            setTemplateDialog({ kind: "save", mealId })
          }
          onAddFromTemplate={(mealId) => {
            // Opened from a meal's menu — not the guided flow, so no Back.
            setLogFlowMealId(null);
            setTemplateDialog({ kind: "apply", mealId });
          }}
          onApplyRecipe={(mealId) => {
            setLogFlowMealId(null);
            setApplyRecipeMealId(mealId);
          }}
          onClearMeal={clearMeal}
          loggedMealSignal={loggedMealSignal}
          onOpenMealDetail={(mealId, intent) => {
            setMealDetailId(mealId);
            setMealHubIntent(intent ?? "add");
          }}
          onOpenLogMeal={() => {
            // Fresh entry from the FAB / "Log meal" button always starts
            // at the meal step, never a stale method step.
            setLogFlowMealId(null);
            setLogMealOpen(true);
          }}
        />
      )}

      {view === "progress" && (
        <ProgressView
          targetCalories={calculatedValues.targetCalories}
          formulaTdee={calculatedValues.tdee}
          dailyDelta={calculatedValues.dailyDelta}
          goal={personalInfo.goal}
          gender={personalInfo.gender}
          heightCm={personalInfo.height}
          units={personalInfo.units}
          onApplyTdee={(tdee) => {
            patchProfile("manualTdee", tdee);
            toast.success(
              `Maintenance set to ${tdee.toLocaleString()} kcal — targets recalculated.`,
            );
          }}
          onWeightLogged={(kg) => patchProfile("weight", kg)}
          waterGoalMl={waterGoalMl(personalInfo)}
          waterGoalOverride={personalInfo.waterGoalMl}
          onSetWaterGoal={(ml) => {
            patchProfile("waterGoalMl", ml);
            toast.success(
              ml == null
                ? "Water goal set to auto (from your weight)."
                : "Water goal updated.",
            );
          }}
          fasting={personalInfo.fasting}
        />
      )}

      {view === "fasting" && <FastingView onSelectView={setView} />}

      {view === "foods" && (
        <MyFoodsView onChange={() => setCustomFoodsRev((r) => r + 1)} />
      )}

      {view === "recipes" && (
        <RecipesView
          profile={personalInfo}
          currentMeals={meals}
        />
      )}

      {view === "templates" && (
        <TemplatesView onGoToPlan={() => setView("plan")} />
      )}

      {view === "shopping" && (
        <ShoppingListView onGoToPlan={() => setView("plan")} />
      )}

      {view === "pantry" && <PantryView aiAvailable={!!user} />}

      {view === "settings" && (
        <SettingsView
          units={personalInfo.units}
          onUnitsChange={(next) => patchProfile("units", next)}
          homeMarket={personalInfo.market}
          onHomeMarketChange={(next) => patchProfile("market", next)}
        />
      )}

      <CameraSheet
        open={cameraSheetOpen}
        onOpenChange={setCameraSheetOpen}
        aiAvailable={!!user}
        initialMode={cameraMode}
        dietPreference={personalInfo.dietPreference}
        pairPhoneAvailable={!!user && !isMobile}
        onFoodPicked={(food) => {
          // From the guided launcher (target meal set) a scanned barcode
          // logs straight to that meal — the inline form it would
          // otherwise populate is hidden on mobile. Otherwise (desktop
          // inline Scan) fall back to seeding the inline form.
          if (logTargetMealId !== null) {
            const dest = meals.find((m) => m.id === logTargetMealId);
            logFoodToMeal(food, logTargetMealId, 100);
            if (dest)
              toast.success(
                addedFoodMessage(
                  food.name,
                  100,
                  Math.round(food.calories),
                  dest.name,
                ),
              );
          } else {
            handleFoodSelect(food);
          }
        }}
        onMealPhotoResolved={(result) => setMealPhotoResult(result)}
        onSwitchToPairPhone={() => setPairPhoneOpen(true)}
        onBack={logFlowMealId !== null ? backToMethod : undefined}
        onUpgrade={() => setCapUpgradeOpen(true)}
      />

      <VoiceLogSheet
        open={voiceSheetOpen}
        onOpenChange={setVoiceSheetOpen}
        aiAvailable={!!user}
        dietPreference={personalInfo.dietPreference}
        // Same downstream pipe as the camera path — both source
        // types feed into the shared `MealPhotoReviewDialog` via
        // `setMealPhotoResult`. The user can edit grams and pick
        // a meal slot before anything actually writes to IDB.
        onResolved={(result) => setMealPhotoResult(result)}
        onBack={logFlowMealId !== null ? backToMethod : undefined}
        onUpgrade={() => setCapUpgradeOpen(true)}
      />

      <PairPhoneDialog
        open={pairPhoneOpen}
        onOpenChange={setPairPhoneOpen}
        onCaptureReady={(payload) => {
          void handlePairedCapture(payload);
        }}
      />

      <MealPhotoReviewDialog
        open={mealPhotoResult !== null}
        onOpenChange={(o) => {
          if (!o) setMealPhotoResult(null);
        }}
        result={mealPhotoResult}
        meals={meals}
        defaultMealId={logTargetMealId ?? undefined}
        onConfirm={(mealId, foods, newCustomFoods) => {
          // Persist the AI-estimated foods first so they're indexed for
          // the next time the user photographs the same item. addCustomFood
          // resolves async but the IDB write is durable; bump the rev so
          // the search list refreshes after navigation.
          if (newCustomFoods.length > 0) {
            (async () => {
              for (const c of newCustomFoods) {
                await addCustomFood({
                  name: c.name,
                  protein: c.protein,
                  carbs: c.carbs,
                  fat: c.fat,
                  calories: c.calories,
                  dietKind: c.dietKind,
                });
              }
              bumpPending();
              setCustomFoodsRev((r) => r + 1);
            })();
          }
          handleBulkAddToMeal(mealId, foods);
          setMealPhotoResult(null);
        }}
      />

      <CustomFoodForm
        open={customFoodOpen}
        onOpenChange={setCustomFoodOpen}
        onSaved={handleCustomFoodSaved}
      />

      <SaveTemplateDialog
        open={templateDialog?.kind === "save"}
        onOpenChange={(o) => {
          if (!o) setTemplateDialog(null);
        }}
        foods={
          templateDialog?.kind === "save"
            ? (meals.find((m) => m.id === templateDialog.mealId)?.foods ?? [])
            : []
        }
        defaultName={
          templateDialog?.kind === "save"
            ? (meals.find((m) => m.id === templateDialog.mealId)?.name ??
              "Meal")
            : "Meal"
        }
        onSaved={() => setTemplateDialog(null)}
      />

      <ApplyTemplateDialog
        open={templateDialog?.kind === "apply"}
        onOpenChange={(o) => {
          if (!o) {
            setTemplateDialog(null);
            setLogFlowMealId(null);
          }
        }}
        targetMealName={
          templateDialog?.kind === "apply"
            ? (meals.find((m) => m.id === templateDialog.mealId)?.name ??
              "Meal")
            : "Meal"
        }
        onApply={handleApplyTemplate}
        onBack={logFlowMealId !== null ? backToMethod : undefined}
      />

      <ApplyRecipeDialog
        open={applyRecipeMealId !== null}
        onOpenChange={(o) => {
          if (!o) {
            setApplyRecipeMealId(null);
            setLogFlowMealId(null);
          }
        }}
        targetMealName={
          applyRecipeMealId !== null
            ? (meals.find((m) => m.id === applyRecipeMealId)?.name ?? "Meal")
            : "Meal"
        }
        dietPreference={personalInfo.dietPreference}
        // Per-slot macro budget. Even split: dailyTarget / mealSlots.
        // Stable while the user fills slots one at a time (denominator
        // is total slot count, not remaining empty slots), which keeps
        // the ranking consistent across opens. Helper returns zeros
        // when the day has no slots — the dialog falls back to natural
        // order on a zero budget.
        slotBudget={computeSlotBudget(
          {
            protein: calculatedValues.protein,
            carbs: calculatedValues.carbs,
            fat: calculatedValues.fat,
          },
          meals.length,
        )}
        onApply={handleApplyRecipe}
        onBack={logFlowMealId !== null ? backToMethod : undefined}
      />

      <MealHubSheet
        meal={meals.find((m) => m.id === mealDetailId) ?? null}
        goal={{
          calories: calculatedValues.targetCalories,
          protein: calculatedValues.protein,
          carbs: calculatedValues.carbs,
          fat: calculatedValues.fat,
        }}
        customFoodsRev={customFoodsRev}
        onLogFood={logFoodToMeal}
        onQuickLog={quickLogFood}
        intent={mealHubIntent}
        onRemoveFood={removeFood}
        onCopyMeal={copyMealItems}
        onAddFromTemplate={(mealId) => {
          setLogFlowMealId(null);
          setTemplateDialog({ kind: "apply", mealId });
        }}
        onApplyRecipe={(mealId) => {
          setLogFlowMealId(null);
          setApplyRecipeMealId(mealId);
        }}
        onRegenerate={handleRegenerateMeal}
        regenerating={isGeneratingMealPlan}
        regeneratingThisMeal={generatingMealId === mealDetailId}
        onOpenChange={(o) => {
          if (!o) setMealDetailId(null);
        }}
      />

      <LogMealSheet
        open={logMealOpen}
        onOpenChange={(o) => {
          setLogMealOpen(o);
          // Dismissing the launcher itself (X / Escape) ends the flow.
          if (!o) setLogFlowMealId(null);
        }}
        meals={meals}
        aiAvailable={!!user}
        initialMealId={logFlowMealId}
        onMethod={handleLogMethod}
        onQuickLog={quickLogFood}
      />

      <FoodSearchSheet
        open={foodSearchOpen}
        onOpenChange={(o) => {
          setFoodSearchOpen(o);
          if (!o) setLogFlowMealId(null);
        }}
        mealId={logTargetMealId}
        mealName={meals.find((m) => m.id === logTargetMealId)?.name ?? "meal"}
        customFoodsRev={customFoodsRev}
        onLogFood={logFoodToMeal}
        onBack={backToMethod}
      />

      <OnboardingWizard
        // The wizard fires when ALL THREE conditions hold:
        //   1. IDB hydration has completed - without this gate the
        //      first render uses `DEFAULT_PROFILE` and would briefly
        //      pass `isDefaultProfile(...)` even for a returning
        //      user, flashing the wizard for ~1 frame before
        //      hydration replaces the profile.
        //   2. The device hasn't recorded a completion (localStorage)
        //   3. The hydrated profile is still default (no synced data
        //      arrived to indicate this user has been here before)
        // If profile sync brings in customized values mid-session,
        // the dialog closes itself - open flips from true to false
        // and Radix unmounts cleanly. New users keep the wizard up
        // until they finish or dismiss.
        open={
          profileHydrated &&
          onboardingGateOpen &&
          onboardingOpen &&
          isDefaultProfile(personalInfo)
        }
        initial={personalInfo}
        onFinish={({ profile, skipped }) => {
          if (profile && !skipped) {
            setPersonalInfo(profile);
            // First run done: land them on the meal planner — their fresh
            // targets plus the log-a-meal action — instead of the default
            // calculator view (a wall of the inputs they just filled in).
            setView("plan");
          }
          markOnboardingDone();
          setOnboardingOpen(false);
        }}
      />

      {suggestDayOpen && (
        <SuggestDayDialog
          open={suggestDayOpen}
          onOpenChange={setSuggestDayOpen}
          meals={meals}
          target={{
            protein: calculatedValues.protein,
            carbs: calculatedValues.carbs,
            fat: calculatedValues.fat,
            calories: calculatedValues.targetCalories,
          }}
          logged={totalMacros}
          onApplyDay={logSuggestedDay}
        />
      )}
      <UpgradeDialog
        open={upgradeDialogOpen}
        onOpenChange={(open) => {
          if (open) return;
          setUpgradeDialogDismissed(true);
          // Strip ?upgrade= so a refresh doesn't reopen the dialog.
          const url = new URL(window.location.href);
          url.searchParams.delete("upgrade");
          const newSearch = url.searchParams.toString();
          window.history.replaceState(
            null,
            "",
            `${url.pathname}${newSearch ? `?${newSearch}` : ""}${url.hash}`,
          );
        }}
        defaultPlan={urlPlan ?? "plus"}
        reason="settings"
      />
      <SignInPromptDialog
        open={signInPromptFeature !== null}
        onOpenChange={(o) => {
          if (!o) setSignInPromptFeature(null);
        }}
        feature={signInPromptFeature ?? undefined}
        next="/app"
      />
      <UpgradeDialog
        open={capUpgradeOpen}
        onOpenChange={setCapUpgradeOpen}
        reason="ai-cap"
        defaultPlan="plus"
      />
    </AppShell>
  );
};

export default MacroCalculator;
