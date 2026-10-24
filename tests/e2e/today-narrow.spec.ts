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

/** Each readout cell's line tops, in reading order (Eaten, Protein, Carbs,
 *  Fat): its figure (the first `dd`) and the small line under it — the
 *  calorie row's "/ 1,950 kcal", a macro row's "N g left" — or `null` when
 *  that small text shares a line (beside the figure or the label). */
async function readoutLines(
  page: Page,
): Promise<{ figure: number; small: number | null }[]> {
  return readoutOf(page)
    .locator(":scope > div")
    .evaluateAll((cells) =>
      cells.map((cell) => {
        const figure = cell.querySelector("dd");
        if (!figure) throw new Error("readout cell without a figure");
        const top = (el: Element) => Math.round(el.getBoundingClientRect().top);
        const small =
          cell.querySelector("dd + dd") ??
          figure.querySelector(":scope > span");
        const figureTop = top(figure);
        // On a line of its own: below the figure's first line.
        const smallTop = small ? top(small) : null;
        return {
          figure: figureTop,
          small:
            smallTop !== null && smallTop - figureTop >= 16 ? smallTop : null,
        };
      }),
    );
}

/** The readout's two rows of cells (Eaten + Protein, Carbs + Fat) whose
 *  figures, or whose small lines, don't share a line (1 px tolerance). */
async function misalignedPairs(page: Page): Promise<string[]> {
  const cells = await readoutLines(page);
  expect(cells).toHaveLength(4);
  const off = (a: number | null, b: number | null) =>
    a === null || b === null ? a !== b : Math.abs(a - b) > 1;
  const issues: string[] = [];
  for (const [i, name] of [
    [0, "Eaten/Protein"],
    [2, "Carbs/Fat"],
  ] as const) {
    const [a, b] = [cells[i], cells[i + 1]];
    if (!a || !b) throw new Error("readout row missing");
    if (off(a.figure, b.figure)) issues.push(`${name} figures`);
    if (off(a.small, b.small)) issues.push(`${name} small lines`);
  }
  return issues;
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
    // Each pair's figures share one line, and so do the lines under them.
    expect(await misalignedPairs(page)).toEqual([]);
  });
}

test("at 320 px every readout cell reads label, figure, then a small line", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { level: 1, name: "Today" }),
  ).toBeVisible();
  const cells = await readoutLines(page);
  // The calorie row's "/ 1,950 kcal" sits on the line the macros' "N g
  // left" takes, whether or not it would fit beside the figure.
  expect(cells.map((c) => c.small !== null)).toEqual([true, true, true, true]);
});

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
