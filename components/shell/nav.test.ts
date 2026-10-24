import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW,
  MORE_SHEET,
  NAV,
  SIDEBAR_GROUPS,
  TAB_BAR,
  VIEW_KEYS,
  YOU_HUB,
  activeTabSlot,
  navPlace,
  viewFromParam,
  type ViewKey,
} from "./nav";

/** Every destination the app has, by its stable `?view=` key. Spelled out
 *  here on purpose: a key renamed or dropped in the registry breaks old
 *  links, bookmarks and emails, so it must fail this test, not slip by. */
const STABLE_KEYS: readonly ViewKey[] = [
  "plan",
  "progress",
  "foods",
  "recipes",
  "templates",
  "shopping",
  "pantry",
  "profile",
  "calculator",
  "health",
  "settings",
];

describe("nav registry", () => {
  it("registers every destination exactly once, keyed by its stable key", () => {
    expect([...VIEW_KEYS].sort()).toEqual([...STABLE_KEYS].sort());
    for (const key of VIEW_KEYS) {
      const d = NAV[key];
      expect(d.label.trim()).not.toBe("");
      expect(d.shortLabel.trim()).not.toBe("");
      expect(d.title.trim()).not.toBe("");
      expect(d.icon).toBeTruthy();
    }
  });

  it("the day view is 'plan', labelled Today, and is the default", () => {
    expect(DEFAULT_VIEW).toBe("plan");
    expect(NAV.plan.label).toBe("Today");
    expect(NAV.plan.title).toBe("Today");
  });

  it("the sidebar lists every destination once, grouped", () => {
    const listed = SIDEBAR_GROUPS.flatMap((g) => g.items);
    expect(listed).toHaveLength(VIEW_KEYS.length);
    expect(new Set(listed)).toEqual(new Set(VIEW_KEYS));
    expect(SIDEBAR_GROUPS.map((g) => [g.label, g.items])).toEqual([
      [null, ["plan", "progress"]],
      ["Library", ["foods", "recipes", "templates"]],
      ["Kitchen", ["shopping", "pantry"]],
      ["You", ["profile", "calculator", "health", "settings"]],
    ]);
  });

  it("tab bar: Today · Progress · quick add · More · You", () => {
    expect(TAB_BAR).toEqual([
      "plan",
      "progress",
      "quickAdd",
      "more",
      "profile",
    ]);
    expect(NAV.profile.shortLabel).toBe("You");
  });

  it("the More sheet lists Foods, Recipes, Templates, Shopping, Pantry, Health & fasting, Settings", () => {
    expect(MORE_SHEET).toEqual([
      "foods",
      "recipes",
      "templates",
      "shopping",
      "pantry",
      "health",
      "settings",
    ]);
    expect(MORE_SHEET.map((k) => NAV[k].label)).toEqual([
      "Foods",
      "Recipes",
      "Templates",
      "Shopping",
      "Pantry",
      "Health & fasting",
      "Settings",
    ]);
  });

  it("the You hub opens the calculator as Targets", () => {
    expect(YOU_HUB).toEqual([
      { key: "calculator", hint: "Calories, macros & goal" },
    ]);
    expect(NAV.calculator.label).toBe("Targets");
  });

  it("every destination is reachable on a phone: tab bar, More sheet or You hub", () => {
    const tabViews = TAB_BAR.filter((s): s is ViewKey => s in NAV);
    const reachable = [
      ...tabViews,
      ...MORE_SHEET,
      ...YOU_HUB.map((t) => t.key),
    ];
    expect(reachable).toHaveLength(VIEW_KEYS.length);
    expect(new Set(reachable)).toEqual(new Set(VIEW_KEYS));
    // The tab bar's views are exactly the destinations whose phone home is
    // the tab bar, so moving a destination is a single edit.
    expect(new Set(tabViews)).toEqual(
      new Set(VIEW_KEYS.filter((k) => NAV[k].mobile === "tab")),
    );
  });
});

describe("viewFromParam", () => {
  it("no ?view= opens Today", () => {
    expect(viewFromParam(null)).toBe("plan");
  });

  it("every registered key opens itself", () => {
    for (const key of STABLE_KEYS) expect(viewFromParam(key)).toBe(key);
  });

  it("aliases: today → plan, fasting → health", () => {
    expect(viewFromParam("today")).toBe("plan");
    expect(viewFromParam("fasting")).toBe("health");
  });

  it.each([
    "",
    "Calculator",
    "unknown",
    "constructor",
    "__proto__",
    "toString",
    "hasOwnProperty",
  ])("unknown %j → Today", (raw) => {
    expect(viewFromParam(raw)).toBe("plan");
  });
});

describe("activeTabSlot", () => {
  it("a tab destination lights its own tab", () => {
    expect(activeTabSlot("plan")).toBe("plan");
    expect(activeTabSlot("progress")).toBe("progress");
    expect(activeTabSlot("profile")).toBe("profile");
  });

  it("a More sheet destination lights More", () => {
    for (const key of MORE_SHEET) expect(activeTabSlot(key)).toBe("more");
  });

  it("a You hub destination lights You", () => {
    expect(activeTabSlot("calculator")).toBe("profile");
  });
});

describe("navPlace", () => {
  it("names a tab destination by its label", () => {
    expect(navPlace("plan")).toBe("Today");
    expect(navPlace("progress")).toBe("Progress");
  });

  it("adds the tab's name when the tab bar shows a different one", () => {
    expect(navPlace("profile")).toBe("Profile (You on a phone)");
  });

  it("gives the way to a You hub tile on a phone", () => {
    expect(navPlace("calculator")).toBe("Targets (You → Targets on a phone)");
  });

  it("names a More sheet destination as the sheet lists it", () => {
    for (const key of MORE_SHEET) expect(navPlace(key)).toBe(NAV[key].label);
  });
});
