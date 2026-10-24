import { expect, type Page, test } from "@playwright/test";

/** Today on narrow phones: the gauge's readout must never squeeze a label
 *  or its "N g left" to an ellipsis. Layout is real-browser only (container
 *  queries), so it lives here rather than in the jsdom unit tests. A
 *  first-run guest has nothing logged, so every macro row reads its whole
 *  target as "N g left" — the widest the label row gets. */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Skip the first-run wizard, which would cover the readout.
    window.localStorage.setItem("maqro:onboarding-done", "1");
  });
});

/** The mono readout beside (or under) the gauge. */
function readoutOf(page: Page) {
  return page.locator("dl", { has: page.locator("dt", { hasText: "Eaten" }) });
}

/** The readout's labels and details whose text doesn't fit their box. */
async function clippedText(page: Page): Promise<string[]> {
  await expect(readoutOf(page).locator("dt")).toHaveCount(4);
  return readoutOf(page)
    .locator("dt, dd")
    .evaluateAll((all) =>
      all
        .filter((el) => el.scrollWidth > el.clientWidth)
        .map((el) => el.textContent ?? ""),
    );
}

/** How many columns the readout's four rows sit in: the distinct left
 *  edges of its labels. */
async function readoutColumns(page: Page): Promise<number> {
  const lefts = await readoutOf(page)
    .locator("dt")
    .evaluateAll((all) =>
      all.map((dt) => Math.round(dt.getBoundingClientRect().left)),
    );
  return new Set(lefts).size;
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
  test(`at ${width} px the gauge sits above a 2 × 2 readout with whole labels`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/app");
    await expect(
      page.getByRole("heading", { level: 1, name: "Today" }),
    ).toBeVisible();
    expect(await clippedText(page)).toEqual([]);
    expect(await gaugeIsAboveReadout(page)).toBe(true);
    expect(await readoutColumns(page)).toBe(2);
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
  expect(await clippedText(page)).toEqual([]);
  expect(await gaugeIsAboveReadout(page)).toBe(false);
  expect(await readoutColumns(page)).toBe(1);
});
