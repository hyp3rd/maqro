import { expect, test } from "@playwright/test";

/** End-to-end smoke for the post-revamp UI. Catches the integration
 * failures the unit tests can't see: SSR/CSR mismatches, hook-order
 * errors, missing client directives, broken sidebar nav, and the
 * Auto-fill (was: Generate Meal Plan) flow. */
test.describe("maqro happy path", () => {
  test("renders the calculator with daily targets", async ({ page }) => {
    await page.goto("/app");
    // Sidebar shows the section names as buttons; topbar shows the title.
    await expect(
      page.getByRole("button", { name: "Calculator" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Meal Plan" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Calculator" }),
    ).toBeVisible();
    // The Daily Targets panel renders with BMR / TDEE / Target.
    await expect(page.getByText("Daily Targets")).toBeVisible();
    await expect(page.getByText("BMR", { exact: true })).toBeVisible();
    await expect(page.getByText("TDEE", { exact: true })).toBeVisible();
    await expect(page.getByText("Target", { exact: true })).toBeVisible();
  });

  test("food search shows the Built-in source badge", async ({ page }) => {
    await page.goto("/app");
    // Navigate via sidebar.
    await page.getByRole("button", { name: "Meal Plan" }).click();
    await page.getByPlaceholder(/Search for a food/i).fill("chicken");
    await expect(page.getByText(/Built-in/).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("Auto-fill populates meals from macro targets", async ({ page }) => {
    await page.goto("/app");
    await page.getByRole("button", { name: "Meal Plan" }).click();
    // The Generate button was renamed Auto-fill. Click whichever is visible.
    await page
      .getByRole("button", { name: /Auto-fill/i })
      .first()
      .click();
    // At least one well-known builtin food should appear in the rendered plan.
    await expect(
      page
        .locator("body")
        .filter({ hasText: /Chicken|Salmon|Oats|Rice|Eggs/ })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("date navigator switches between today and yesterday", async ({
    page,
  }) => {
    await page.goto("/app");
    await page.getByRole("button", { name: "Meal Plan" }).click();

    // Start on today.
    await expect(page.getByText("Today", { exact: true })).toBeVisible();

    // Click "Previous day" to go to yesterday.
    await page.getByRole("button", { name: "Previous day" }).click();
    await expect(page.getByText("Yesterday", { exact: true })).toBeVisible();
    // The "Today" snap-back button appears when off today.
    await expect(page.getByRole("button", { name: "Today" })).toBeVisible();

    // Snap back to today.
    await page.getByRole("button", { name: "Today" }).click();
    await expect(page.getByText("Today", { exact: true })).toBeVisible();
  });

  test("meal templates round-trip: save then apply on an empty meal", async ({
    page,
  }) => {
    await page.goto("/app");
    await page.getByRole("button", { name: "Meal Plan" }).click();

    // Auto-fill the day so Breakfast has foods to save.
    await page
      .getByRole("button", { name: /Auto-fill/i })
      .first()
      .click();
    await expect(
      page
        .locator("body")
        .filter({ hasText: /Chicken|Salmon|Oats|Rice|Eggs/ })
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    // Open Breakfast's action menu and save as template.
    await page.getByRole("button", { name: "Breakfast actions" }).click();
    await page.getByRole("menuitem", { name: /Save as template/ }).click();
    // Dialog: name + Save.
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Test template");
    await dialog.getByRole("button", { name: /Save template/ }).click();
    await expect(dialog).toBeHidden();

    // Wait for the dailyLog debounced write to flush before reload.
    await page.waitForTimeout(800);

    // Reload, navigate to a clean day (yesterday), then apply the template
    // to that day's Breakfast.
    await page.reload();
    await page.getByRole("button", { name: "Meal Plan" }).click();
    await page.getByRole("button", { name: "Previous day" }).click();

    await page.getByRole("button", { name: "Breakfast actions" }).click();
    await page.getByRole("menuitem", { name: /Add from template/ }).click();

    // Click the saved template in the dialog list.
    const applyDialog = page.getByRole("dialog");
    await applyDialog.getByText("Test template").click();
    await expect(applyDialog).toBeHidden();

    // Foods should appear in yesterday's Breakfast. We assert against the
    // structural marker (a row in the meal table) rather than a fixed food
    // name, since the planner picks foods randomly each run.
    const breakfastSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Breakfast" }) });
    await expect(
      breakfastSection.getByRole("row").nth(1), // 0 = header row
    ).toBeVisible({ timeout: 5_000 });
  });

  test("changing weight auto-logs to Progress view", async ({ page }) => {
    await page.goto("/app");
    // Set weight to a distinct value the chart can show.
    const weightInput = page.getByLabel("Weight (kg)");
    await weightInput.fill("");
    await weightInput.fill("78");
    // Wait for the 500ms debounce to flush profile + weightHistory.
    await page.waitForTimeout(900);

    await page.getByRole("button", { name: "Progress" }).click();

    // Heading visible + the weight value rendered in the headline ticker.
    await expect(page.getByRole("heading", { name: "Weight" })).toBeVisible();
    await expect(page.getByText(/78\.0\s*kg/)).toBeVisible({ timeout: 5_000 });
  });

  test("manual weigh-in form records a measurement", async ({ page }) => {
    await page.goto("/app");
    await page.getByRole("button", { name: "Progress" }).click();

    // Empty state → form visible.
    await expect(
      page.getByRole("heading", { name: "Log weigh-in" }),
    ).toBeVisible();

    await page.getByLabel("Weight (kg)", { exact: false }).fill("75.5");
    await page.getByRole("button", { name: /^Save$/ }).click();

    // The weight headline ticker should reflect the new entry (the
    // weight section also surfaces a label, so pick the first match).
    await expect(page.getByText(/75\.5\s*kg/).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("empty day prompt appears when no meals are logged", async ({
    page,
  }) => {
    await page.goto("/app");
    await page.getByRole("button", { name: "Meal Plan" }).click();
    // Default state is empty → prompt should be visible.
    await expect(page.getByText(/No meals logged for this day/)).toBeVisible();
  });

  test("profile + meal log persist across a reload", async ({ page }) => {
    // First visit: change weight to a distinctive value and Auto-fill meals.
    await page.goto("/app");
    const weightInput = page.getByLabel("Weight (kg)");
    await weightInput.fill("");
    await weightInput.fill("83");

    await page.getByRole("button", { name: "Meal Plan" }).click();
    await page
      .getByRole("button", { name: /Auto-fill/i })
      .first()
      .click();
    await expect(
      page
        .locator("body")
        .filter({ hasText: /Chicken|Salmon|Oats|Rice|Eggs/ })
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    // Give the 500ms debounce time to flush.
    await page.waitForTimeout(800);

    // Reload: the weight should still be 83 and meals should still be filled.
    await page.reload();
    await expect(page.getByLabel("Weight (kg)")).toHaveValue("83");

    await page.getByRole("button", { name: "Meal Plan" }).click();
    await expect(
      page
        .locator("body")
        .filter({ hasText: /Chicken|Salmon|Oats|Rice|Eggs/ })
        .first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
