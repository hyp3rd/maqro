import { describe, expect, it } from "vitest";
import { collectHydrationEnvironment } from "./hydration-environment";

const base = {
  htmlLang: "en",
  htmlClassList: [] as string[],
  htmlAttributeNames: ["lang", "class"],
  bodyAttributeNames: ["class"],
  bodyChildTags: ["DIV", "SCRIPT"] as string[],
  navigatorLanguage: "en-US",
};

describe("collectHydrationEnvironment — locale mismatch", () => {
  it("flags a mismatch when page lang and browser language differ", () => {
    const env = collectHydrationEnvironment({
      ...base,
      htmlLang: "en",
      navigatorLanguage: "it-IT",
    });
    expect(env.localeMismatch).toBe(true);
  });

  it("ignores region — same primary subtag is not a mismatch", () => {
    const env = collectHydrationEnvironment({
      ...base,
      htmlLang: "en",
      navigatorLanguage: "en-GB",
    });
    expect(env.localeMismatch).toBe(false);
  });

  it("does not flag a mismatch when a side is empty (no signal)", () => {
    expect(
      collectHydrationEnvironment({
        ...base,
        htmlLang: "",
        navigatorLanguage: "it",
      }).localeMismatch,
    ).toBe(false);
    expect(
      collectHydrationEnvironment({
        ...base,
        htmlLang: "en",
        navigatorLanguage: "",
      }).localeMismatch,
    ).toBe(false);
  });
});

describe("collectHydrationEnvironment — translation detection", () => {
  it("detects Google/Chrome Translate via the html direction class", () => {
    const env = collectHydrationEnvironment({
      ...base,
      htmlClassList: ["font-sans", "translated-ltr"],
    });
    expect(env.translationActive).toBe(true);
  });

  it("detects Edge/Bing Translate via the _msthash attributes", () => {
    const env = collectHydrationEnvironment({
      ...base,
      bodyAttributeNames: ["class", "_msthash", "_msttexthash"],
    });
    expect(env.translationActive).toBe(true);
  });

  it("reports no translation when neither marker is present", () => {
    expect(collectHydrationEnvironment(base).translationActive).toBe(false);
  });
});

describe("collectHydrationEnvironment — extension signals", () => {
  it("names DOM-mutating extensions from injected attributes", () => {
    const env = collectHydrationEnvironment({
      ...base,
      bodyAttributeNames: [
        "class",
        "data-gr-ext-installed",
        "data-new-gr-c-s-check-loaded",
      ],
      htmlAttributeNames: ["lang", "data-darkreader-mode"],
    });
    expect(env.extensionSignals).toContain("Grammarly");
    expect(env.extensionSignals).toContain("Dark Reader");
  });

  it("dedupes when one extension injects several marker attributes", () => {
    const env = collectHydrationEnvironment({
      ...base,
      bodyAttributeNames: [
        "data-gr-ext-installed",
        "data-gramm",
        "data-gramm_editor",
      ],
    });
    expect(env.extensionSignals).toEqual(["Grammarly"]);
  });

  it("names password-manager extensions from injected body elements", () => {
    const env = collectHydrationEnvironment({
      ...base,
      bodyChildTags: ["DIV", "PROTONPASS-ROOT-3B89", "SCRIPT"],
    });
    expect(env.extensionSignals).toContain("ProtonPass");
  });

  it("detects 1Password's injected element too", () => {
    const env = collectHydrationEnvironment({
      ...base,
      bodyChildTags: ["DIV", "COM-1PASSWORD-BUTTON"],
    });
    expect(env.extensionSignals).toContain("1Password");
  });

  it("returns an empty list when the DOM is clean", () => {
    expect(collectHydrationEnvironment(base).extensionSignals).toEqual([]);
  });
});
