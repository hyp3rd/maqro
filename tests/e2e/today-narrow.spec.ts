import { expect, type Page, test } from "@playwright/test";

/** Today on narrow phones: the gauge's readout must never squeeze a label
 *  to an ellipsis. Layout is real-browser only (container queries), so it
 *  lives here rather than in the jsdom unit tests. A first-run guest has
 *  nothing logged, so every macro row reads its whole target as "N g
 *  left" — the widest the label row gets. */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("maqro:onboarding-done", "1");
    } catch {
      /* storage disabled — the wizard may open; the checks below don't
         depend on it being closed */
    }
  });
});

/** The mono readout beside (or under) the gauge. */
function readoutOf(page: Page) {
  return page.locator("dl", { has: page.locator("dt", { hasText: "Eaten" }) });
}

/** The labels whose text doesn't fit their box. */
async function clippedLabels(page: Page): Promise<string[]> {
  const terms = readoutOf(page).locator("dt");
  await expect(terms).toHaveCount(4);
  return terms.evaluateAll((all) =>
    all
      .filter((dt) => dt.scrollWidth > dt.clientWidth)
      .map((dt) => dt.textContent ?? ""),
  );
}

async function gaugeIsAboveReadout(page: Page): Promise<boolean> {
  // The gauge's centre (its live region) covers the whole gauge.
  const gauge = await page
    .getByRole("status")
    .filter({ hasText: "kcal" })
    .first()
    .boundingBox();
  const readout = await readoutOf(page).boundingBox();
  if (!gauge || !readout) throw new Error("gauge row not laid out");
  return gauge.y + gauge.height <= readout.y;
}

for (const width of [320, 360]) {
  test(`at ${width} px the gauge sits above a readout with whole labels`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/app");
    await expect(
      page.getByRole("heading", { level: 1, name: "Today" }),
    ).toBeVisible();
    expect(await clippedLabels(page)).toEqual([]);
    expect(await gaugeIsAboveReadout(page)).toBe(true);
  });
}

test("at 390 px the readout sits beside the gauge with whole labels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { level: 1, name: "Today" }),
  ).toBeVisible();
  expect(await clippedLabels(page)).toEqual([]);
  expect(await gaugeIsAboveReadout(page)).toBe(false);
});
