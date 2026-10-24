import { expect, type Page, test } from "@playwright/test";

/** Open the day view ("Today") from the desktop sidebar. Scoped to the
 *  sidebar: the day's heading and its snap-back button are named "Today"
 *  too. */
async function openToday(page: Page): Promise<void> {
  await page
    .getByRole("complementary", { name: "Primary navigation" })
    .getByRole("button", { name: "Today", exact: true })
    .click();
}

/** Yesterday's local `YYYY-MM-DD` (the browser runs in this process's
 *  timezone). */
function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Show yesterday through the Today header's date picker (the week strip
 *  holds only the shown day's week, and yesterday is last week's Sunday on
 *  a Monday). */
async function showYesterday(page: Page): Promise<void> {
  await page.getByLabel(/choose a day/).fill(yesterdayKey());
}

/** End-to-end smoke for the post-revamp UI. Catches the integration
 * failures the unit tests can't see: SSR/CSR mismatches, hook-order
 * errors, missing client directives, broken sidebar nav, and the
 * Auto-fill (was: Generate Meal Plan) flow. */
test.describe("maqro happy path", () => {
  // Suppress the first-run onboarding wizard. It opens asynchronously (a 1.5s
  // grace-gate), so on a slow run it can appear mid-test and steal the generic
  // `getByRole("dialog")` from, e.g., the save-as-template dialog. Seeding the
  // device "done" flag before the app boots mirrors a returning user and keeps
  // every test deterministic regardless of machine speed.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("maqro:onboarding-done", "1");
      } catch {
        /* storage disabled — ignore */
      }
    });
  });

  test("lands on Today; Targets renders the daily targets", async ({
    page,
  }) => {
    await page.goto("/app");
    // Today-first: the day view is the landing view.
    await expect(
      page.getByRole("heading", { level: 1, name: "Today" }),
    ).toBeVisible();
    // Sidebar shows the section names as buttons; topbar shows the title.
    await page.getByRole("button", { name: "Targets", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Targets" }),
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
    await page.goto("/app?view=calculator");

    // The Calculator shows a compact body-summary strip (gender · age ·
    // weight · height) in place of the Body inputs, which moved to Profile.
    const strip = page.getByRole("button", { name: /Edit on Profile/ });
    await expect(strip).toBeVisible();
    await expect(strip).toContainText("70.0 kg"); // default weight
    // The Body inputs themselves are gone from the Calculator.
    await expect(page.getByLabel("Weight (kg)")).toHaveCount(0);

    // The strip jumps to Profile, which carries the Body card + birthdate.
    await strip.click();
    await expect(
      page.getByRole("heading", { name: "You", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Birthdate")).toBeVisible();

    // Editing weight on Profile flows back into the Calculator's targets.
    const weightInput = page.getByLabel("Weight (kg)");
    await weightInput.fill("");
    await weightInput.fill("90");
    await page.waitForTimeout(700);

    await page.getByRole("button", { name: "Targets", exact: true }).click();
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
    await openToday(page);
    await page.getByPlaceholder(/Search for a food/i).fill("chicken");
    await expect(page.getByText(/Built-in/).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("Auto-fill populates meals from macro targets", async ({ page }) => {
    await page.goto("/app");
    await openToday(page);
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

  test("meal hub: manual search stays open when tapped (regression)", async ({
    page,
  }) => {
    await page.goto("/app");
    await openToday(page);

    // Empty slot → the single "Add food" affordance steps into the per-meal
    // hub; the hub's own "Add food" button opens the full-screen manual search.
    await page.getByRole("button", { name: "Add food" }).first().click();
    const hub = page.getByRole("dialog");
    await expect(hub).toBeVisible();
    await hub.getByRole("button", { name: "Add food" }).click();

    const searchSheet = page.getByRole("dialog", { name: /Add food to/ });
    await expect(searchSheet).toBeVisible();

    // Regression: the search sheet is a sibling portal stacked over the
    // non-modal hub dialog, so a tap inside it used to count as an outside-
    // interaction on the hub — closing the hub and unmounting the search with
    // it. Tapping the search box must NOT close the sheet, and it must stay
    // interactive (the user couldn't focus anything before the fix).
    const input = searchSheet.getByPlaceholder(/Search for a food/i);
    await input.click();
    await expect(searchSheet).toBeVisible();
    await input.fill("egg");
    await expect(input).toHaveValue("egg");
  });

  test("the day header switches between today and yesterday", async ({
    page,
  }) => {
    await page.goto("/app");
    await openToday(page);

    // Start on today. The Today header is the page's one heading (the top
    // bar carries none on this view).
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveCount(1);
    await expect(heading).toHaveText("Today");

    // Pick yesterday from the header's date.
    await showYesterday(page);
    await expect(heading).toHaveText("Yesterday");
    // One way back to today, off today only (in the day view, not the
    // sidebar's "Today").
    const snapBack = page
      .getByRole("main")
      .getByRole("button", { name: "Back to today" });
    await expect(snapBack).toHaveCount(1);

    // Snap back to today: the heading names it and takes focus.
    await snapBack.click();
    await expect(heading).toHaveText("Today");
    await expect(heading).toBeFocused();
    await expect(snapBack).toHaveCount(0);
  });

  test("meal templates round-trip: save then apply on an empty meal", async ({
    page,
  }) => {
    await page.goto("/app");
    await openToday(page);

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
    await openToday(page);
    await showYesterday(page);

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
    await openToday(page);
    // Default state is empty → prompt should be visible, naming the
    // desktop's add (the search above the meals).
    await expect(page.getByText(/No meals logged for this day/)).toBeVisible();
    await expect(
      page.getByText("Use the search above to add foods to any meal,"),
    ).toBeVisible();
  });

  test("on a phone the empty day prompt names the adds a phone has", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app");
    await expect(page.getByText(/No meals logged for this day/)).toBeVisible();
    // The search is desktop-only; today offers the tab bar's [+] and each
    // meal's Add food.
    await expect(
      page.getByText("Use the search above to add foods to any meal,"),
    ).toBeHidden();
    await expect(page.getByText(/below to log a meal, use/)).toBeVisible();

    // [+] always logs into today, so a past day offers only Add food.
    await showYesterday(page);
    await expect(page.getByText(/No meals logged for this day/)).toBeVisible();
    await expect(page.getByText(/below to log a meal/)).toHaveCount(0);
    await expect(page.getByText(/Use Add food on any meal,/)).toBeVisible();
  });

  test("profile + meal log persist across a reload", async ({ page }) => {
    // First visit: change weight to a distinctive value and Auto-fill meals.
    await page.goto("/app");
    // Weight lives on the Profile page now.
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    const weightInput = page.getByLabel("Weight (kg)");
    await weightInput.fill("");
    await weightInput.fill("83");

    await openToday(page);
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

    await openToday(page);
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

  test("fasting: stopping a running fast archives it to history", async ({
    page,
  }) => {
    // `?demo=1` seeds a profile on a 16:8 protocol whose running fast is
    // derived from the seeded meals: it starts at the last food of the latest
    // fully eaten day. The profile matters twice over: the fasting card reads
    // it straight from IDB and only renders once it's there (a fresh guest's
    // default is never persisted), and the running fast gives us a Stop control
    // to exercise record-on-stop.
    //
    // That fast depends on the time of day (an open eating window around
    // midday, a fresh 0-4h fast after dinner), so pin the browser's clock to
    // 06:00 local today: the fast then runs from last night's ~19:30 dinner,
    // ~10.5h in and still in the "fasting" phase. `setFixedTime` fixes
    // `Date` only and keeps timers running, so the app's timeouts still fire.
    const sixAm = new Date();
    sixAm.setHours(6, 0, 0, 0);
    await page.clock.setFixedTime(sixAm);
    await page.goto("/app?demo=1");
    await openToday(page);

    // Wait out the demo seed + IDB hydrate before the card's Stop appears.
    const stop = page.getByRole("button", { name: "Stop fasting now" });
    await expect(stop).toBeVisible({ timeout: 10_000 });
    await stop.click();
    // Confirm — the trigger read "Stop fasting now"; the dialog action is the
    // exact "Stop fasting".
    await page
      .getByRole("button", { name: "Stop fasting", exact: true })
      .click();

    // The completed ~10.5h overnight fast now shows in the archive on the
    // Health page, which absorbed the old Fasting view
    // (record-on-stop → fastSessions store → useFastSessions → history card).
    await page
      .getByRole("button", { name: "Health & fasting", exact: true })
      .click();
    const history = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Fasting history" }) });
    await expect(
      history.getByRole("heading", { name: "Fasting history" }),
    ).toBeVisible();
    await expect(history.getByText(/10h/)).toBeVisible();
    await expect(history.getByText(/Reached/)).toBeVisible();
  });
});
