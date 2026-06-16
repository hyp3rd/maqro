import { expect, test } from "@playwright/test";

/** End-to-end for the Meal Schedules feature — the one flow the unit tests
 * can't cover end to end: a recipe is scheduled onto a meal slot, the planner
 * surfaces a one-tap "Log it" offer on the matching day, and tapping it appends
 * the recipe's foods to that meal.
 *
 * Why guest mode (no `?demo=1`): the whole feature is IndexedDB-only — recipes,
 * schedules, and the daily log never need auth. Crucially we want the day's
 * meals to start EMPTY: the scheduled-log offer only renders on an empty slot
 * (`meal.foods.length === 0`), so the `?demo=1` seed (which can populate meals)
 * would hide it. A fresh guest's default day is empty, which is exactly the
 * state under test.
 *
 * SCOPE: this drives the create-recipe → schedule → today-offer → log path and
 * asserts the recipe's food lands in the slot. It deliberately does NOT seed a
 * pantry, so there is no pantry draw to assert here — the shortfall / per-food
 * consumption math is already covered by unit tests
 * (`lib/pantry/availability`, `planPerFoodConsumptionAgainstBalance`), and a
 * name-matched pantry seed would couple the test to whichever "chicken" food
 * the catalog returns. Keeping the seam explicit beats a brittle assertion. */
test.describe("meal schedules", () => {
  const RECIPE = "E2E Scheduled Bowl";

  // Full weekday names, indexed to match `Date.getDay()` (0 = Sunday) — the
  // same basis the scheduler's day-of-week toggles use (their aria-labels are
  // these names) and the same basis `schedulesForDay` matches on. We read the
  // current day INSIDE the browser so it agrees with the app's `todayKey()`
  // rather than the test runner's clock (which can differ near midnight / in a
  // different timezone).
  const DOW_FULL = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ] as const;

  // Suppress the first-run onboarding wizard so its async dialog can't steal a
  // generic `getByRole("dialog")` mid-test. Mirrors the smoke suite — seeding
  // the device "done" flag before boot makes every run deterministic.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("maqro:onboarding-done", "1");
      } catch {
        /* storage disabled — ignore */
      }
    });
  });

  test("schedule a recipe, then one-tap log it from today's offer", async ({
    page,
  }) => {
    await page.goto("/app");

    // ── 1. Build a recipe with one built-in ingredient ──────────────────────
    await page.getByRole("button", { name: "Recipes" }).click();
    await page.getByRole("button", { name: "New recipe" }).click();

    const recipeForm = page.getByRole("dialog", { name: "New recipe" });
    await expect(recipeForm).toBeVisible();
    await recipeForm.getByLabel("Name", { exact: true }).fill(RECIPE);

    // The ingredient picker shares the app's food search; "chicken" reliably
    // returns the built-in catalog. Pick the first built-in result (the form
    // renders the raw `food.source`, which is the lowercase "builtin" token —
    // not the "Built-in" display label the food-search sheet maps it to).
    // Picking adds it at the default 100 g portion (a "Total:" line confirms).
    await recipeForm.getByPlaceholder(/Search built-in/i).fill("chicken");
    const firstResult = recipeForm
      .getByRole("button", { name: /builtin/ })
      .first();
    await expect(firstResult).toBeVisible({ timeout: 5_000 });
    await firstResult.click();
    await expect(recipeForm.getByText(/^Total:/)).toBeVisible();

    await recipeForm.getByRole("button", { name: "Save recipe" }).click();
    await expect(recipeForm).toBeHidden();

    // ── 2. Schedule it onto today's Breakfast ───────────────────────────────
    await page.getByRole("button", { name: `Actions for ${RECIPE}` }).click();
    await page.getByRole("menuitem", { name: "Schedule" }).click();

    const sched = page.getByRole("dialog", { name: /Cook once/ });
    await expect(sched).toBeVisible();

    // The dialog defaults the day-of-week set to weekdays (Mon–Fri). Guarantee
    // TODAY is selected regardless of which day the suite runs — toggling only
    // when it isn't already on (so we never accidentally turn a weekday off).
    const todayDow = await page.evaluate(() => new Date().getDay());
    const todayName = DOW_FULL[todayDow];
    const dayBtn = sched.getByRole("button", { name: todayName, exact: true });
    if ((await dayBtn.getAttribute("aria-pressed")) !== "true") {
      await dayBtn.click();
    }
    await expect(dayBtn).toHaveAttribute("aria-pressed", "true");

    // Schedule ONLY Breakfast. The dialog defaults to selecting Lunch (the
    // second slot), so we enable Breakfast and disable Lunch — gating on
    // aria-pressed so it holds regardless of which slot the dialog defaulted
    // to. A single target slot keeps "Scheduled (1)" and the today-offer
    // unambiguous (two slots would render two identical offers).
    const breakfastSlot = sched.getByRole("button", {
      name: "Breakfast",
      exact: true,
    });
    if ((await breakfastSlot.getAttribute("aria-pressed")) !== "true") {
      await breakfastSlot.click();
    }
    await expect(breakfastSlot).toHaveAttribute("aria-pressed", "true");

    const lunchSlot = sched.getByRole("button", { name: "Lunch", exact: true });
    if ((await lunchSlot.getAttribute("aria-pressed")) === "true") {
      await lunchSlot.click();
    }
    await expect(lunchSlot).toHaveAttribute("aria-pressed", "false");

    await sched.getByRole("button", { name: "Schedule", exact: true }).click();
    await expect(sched).toBeHidden();

    // The "Scheduled" management section now lists it.
    await expect(
      page.getByRole("heading", { name: /Scheduled \(\d+\)/ }),
    ).toBeVisible();

    // ── 3. The planner offers a one-tap log on today's empty Breakfast ──────
    // Reload so the planner re-reads schedules from IDB on a clean mount
    // (the live data-bus bump also works, but a reload is deterministic).
    await page.reload();
    await page.getByRole("button", { name: "Meal Plan" }).click();

    // Only Breakfast is scheduled, so the offer is unique page-wide.
    const offer = page.getByRole("button", {
      name: new RegExp(`Scheduled: ${RECIPE}`),
    });
    // Allow for first-load hydration + the schedules read before the offer
    // appears.
    await expect(offer).toBeVisible({ timeout: 10_000 });

    // ── 4. Tapping it logs the recipe's food into the slot ──────────────────
    await offer.click();
    // The slot is no longer empty, so the offer (an empty-state affordance)
    // unmounts, and the picked food appears as a row in the meal table. The
    // meal renders a visible desktop table alongside a hidden responsive
    // layout (so the name node exists twice) — pin to the visible instance.
    await expect(offer).toBeHidden();
    await expect(
      page
        .getByRole("row", { name: /Chicken Breast/ })
        .filter({ visible: true })
        .first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
