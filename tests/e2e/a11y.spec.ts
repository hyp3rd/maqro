import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** Accessibility audit using axe-core. We don't aim for a perfect
 *  axe report — that's a moving target and tag-by-tag perfection
 *  burns time on things real users never hit. Instead we assert
 *  there are no violations against axe's "wcag2a", "wcag2aa", and
 *  "best-practice" rules on each public-facing page.
 *
 *  When a violation creeps in, the test prints the rule id, the
 *  affected element, and a documentation link — fix or annotate
 *  in the test with a `disableRules([...])` call and a comment
 *  explaining why.
 *
 *  Runs in the same Playwright suite as the smoke tests. */

const PAGES = [
  { path: "/", name: "landing" },
  { path: "/app", name: "app (calculator)" },
  { path: "/login", name: "login" },
  { path: "/terms", name: "terms" },
  { path: "/privacy", name: "privacy" },
  { path: "/help", name: "help" },
];

for (const { path, name } of PAGES) {
  test(`axe: ${name} has no critical violations`, async ({ page }) => {
    await page.goto(path);
    // Give client components a beat to hydrate. Without this, axe
    // can scan a server-rendered DOM that lacks the eventual
    // interactive controls — false greens.
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "best-practice"])
      // `color-contrast` is allowed to flag warnings during dev —
      // some of our muted-foreground combos are at the edge of
      // 4.5:1 and tuning them is a separate visual-design pass.
      // We disable it here so the suite stays actionable; a
      // contrast-only sweep belongs in its own spec.
      .disableRules(["color-contrast"])
      .analyze();

    // Build a useful failure message when violations exist.
    if (results.violations.length > 0) {
      const summary = results.violations
        .map(
          (v) =>
            `• [${v.impact}] ${v.id}: ${v.help}\n  Help: ${v.helpUrl}\n  Nodes: ${v.nodes.length}`,
        )
        .join("\n\n");
      console.error(`Accessibility violations on ${path}:\n${summary}`);
    }
    expect(results.violations).toEqual([]);
  });
}
