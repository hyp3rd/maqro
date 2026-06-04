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

  test("Profile holds the body inputs; the Calculator shows a linking summary strip", async ({
    page,
  }) => {
    await page.goto("/app");

    // The Calculator shows a compact body-summary strip (gender · age ·
    // weight · height) in place of the Body inputs, which moved to Profile.
    const strip = page.getByRole("button", { name: /Edit on Profile/ });
    await expect(strip).toBeVisible();
    await expect(strip).toContainText("70.0 kg"); // default weight
    // The Body inputs themselves are gone from the Calculator.
    await expect(page.getByLabel("Weight (kg)")).toHaveCount(0);

    // The strip jumps to Profile, which carries the Body card + birthdate.
    await strip.click();
    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
    await expect(page.getByLabel("Birthdate")).toBeVisible();

    // Editing weight on Profile flows back into the Calculator's targets.
    const weightInput = page.getByLabel("Weight (kg)");
    await weightInput.fill("");
    await weightInput.fill("90");
    await page.waitForTimeout(700);

    await page.getByRole("button", { name: "Calculator", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /Edit on Profile/ }),
    ).toContainText("90.0 kg");
  });

  test("Profile: logging a blood-pressure reading shows it in history", async ({
    page,
  }) => {
    await page.goto("/app");
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    // BP + body measurements live behind the "My measurements" tile now.
    await page.getByRole("button", { name: /My measurements/ }).click();

    await expect(
      page.getByRole("heading", { name: "Blood pressure" }),
    ).toBeVisible();

    // "Diastolic" contains the substring "systolic", so match labels exactly.
    await page.getByLabel("Systolic", { exact: true }).fill("128");
    await page.getByLabel("Diastolic", { exact: true }).fill("82");
    await page.getByLabel("Pulse (bpm)").fill("66");
    await page.getByRole("button", { name: "Log reading" }).click();

    // The reading lands in the history list, classified (128/82 → Stage 1).
    await expect(page.getByText("128/82")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Stage 1")).toBeVisible();

    // The Profile also carries the read-only body-measurement archive.
    await expect(
      page.getByRole("heading", { name: "Body measurements" }),
    ).toBeVisible();
  });

  test("logging a weigh-in updates the Profile weight", async ({ page }) => {
    await page.goto("/app");
    // Log a today weigh-in in Progress.
    await page.getByRole("button", { name: "Progress", exact: true }).click();
    await page.getByLabel("Weight (kg)", { exact: false }).fill("72.3");
    await page.getByRole("button", { name: /^Save$/ }).click();
    await page.waitForTimeout(900); // let the profile patch + debounce settle

    // The Profile body card now reflects the logged weight (not the default).
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(page.getByLabel("Weight (kg)")).toHaveValue("72.3");
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
    // Body inputs (incl. weight) live on the Profile page now.
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    // Set weight to a distinct value the chart can show.
    const weightInput = page.getByLabel("Weight (kg)");
    await weightInput.fill("");
    await weightInput.fill("78");
    // Wait for the 500ms debounce to flush profile + weightHistory.
    await page.waitForTimeout(900);

    await page.getByRole("button", { name: "Progress", exact: true }).click();

    // Heading visible + the weight value rendered in the headline ticker.
    await expect(page.getByRole("heading", { name: "Weight" })).toBeVisible();
    await expect(page.getByText(/78\.0\s*kg/)).toBeVisible({ timeout: 5_000 });
  });

  test("manual weigh-in form records a measurement", async ({ page }) => {
    await page.goto("/app");
    await page.getByRole("button", { name: "Progress", exact: true }).click();

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
    // Weight lives on the Profile page now.
    await page.getByRole("button", { name: "Profile", exact: true }).click();
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
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(page.getByLabel("Weight (kg)")).toHaveValue("83");

    await page.getByRole("button", { name: "Meal Plan" }).click();
    await expect(
      page
        .locator("body")
        .filter({ hasText: /Chicken|Salmon|Oats|Rice|Eggs/ })
        .first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("Settings: a v3 backup's new health tables show in the import preview", async ({
    page,
  }) => {
    await page.goto("/app");
    await page.getByRole("button", { name: "Settings", exact: true }).click();

    const bundle = {
      version: 3,
      exportedAt: "2026-01-01T00:00:00.000Z",
      user: null,
      data: {
        bodyMeasurements: [
          {
            date: "2026-05-15",
            waistCm: 82,
            neckCm: 38,
            hipsCm: 95,
            recordedAt: 1_700_000_000_000,
          },
        ],
        waterIntake: [
          { date: "2026-05-15", ml: 2300, recordedAt: 1_700_000_000_000 },
        ],
        bloodPressure: [
          {
            date: "2026-05-15",
            systolic: 122,
            diastolic: 78,
            recordedAt: 1_700_000_000_000,
          },
        ],
      },
    };
    await page
      .locator('input[accept="application/json,.json"]')
      .setInputFiles({
        name: "backup.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(bundle)),
      });

    // The preview lists the three new stores the completed bundle adds.
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Body measurements")).toBeVisible();
    await expect(dialog.getByText("Water intake")).toBeVisible();
    await expect(dialog.getByText("Blood pressure")).toBeVisible();
  });

  test("Settings: importing an encrypted backup prompts for a passphrase", async ({
    page,
  }) => {
    await page.goto("/app");
    await page.getByRole("button", { name: "Settings", exact: true }).click();

    // A well-formed encrypted envelope (valid base64 fields) with garbage
    // ciphertext — enough to be detected as encrypted and to fail decryption.
    const envelope = {
      format: "maqro-encrypted-export",
      v: 1,
      kdf: "PBKDF2-SHA256",
      iterations: 600_000,
      salt: Buffer.from("0123456789abcdef").toString("base64"),
      iv: Buffer.from("0123456789ab").toString("base64"),
      ciphertext: Buffer.from("not a real ciphertext").toString("base64"),
      exportedAt: "2026-01-01T00:00:00.000Z",
    };
    await page
      .locator('input[accept="application/json,.json"]')
      .setInputFiles({
        name: "encrypted.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(envelope)),
      });

    // The unlock dialog appears for the encrypted file.
    await expect(
      page.getByRole("heading", { name: "Unlock this backup" }),
    ).toBeVisible();
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("some-passphrase");
    await page.getByRole("button", { name: "Unlock" }).click();
    // Garbage ciphertext → AES-GCM fails closed, surfaced as a readable error.
    await expect(page.getByText(/Wrong passphrase|corrupted/i)).toBeVisible({
      timeout: 5_000,
    });
  });

  test("Report page renders the blood-pressure, hydration and fasting sections", async ({
    page,
  }) => {
    await page.goto(
      "/report?days=60&sections=bloodPressure,water,fasting&title=Test%20report",
    );
    await expect(
      page.getByRole("heading", { name: "Blood pressure" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Hydration" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Intermittent fasting" }),
    ).toBeVisible();
  });

  test("Report page generates a vector PDF download", async ({ page }) => {
    await page.goto("/report?days=60&sections=summary&title=Test%20report");
    // @react-pdf/renderer (WASM layout engine) renders the blob in-browser;
    // a download firing proves it loaded + generated under Turbopack.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download PDF" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("maqro-report.pdf");
  });

  test("Report: 'Archive to cloud' surfaces a status message when signed out", async ({
    page,
  }) => {
    await page.goto("/report?days=60&sections=summary&title=Test%20report");
    await page.getByRole("button", { name: /Archive to cloud/ }).click();
    // Signed-out (or unconfigured) → a status message, not a crash. (The PDF
    // build only runs once past the auth guard, so nothing heavy fires here.)
    await expect(page.getByRole("status")).toBeVisible({ timeout: 5_000 });
  });
});
