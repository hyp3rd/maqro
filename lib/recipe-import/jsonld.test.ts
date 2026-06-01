import { describe, expect, it } from "vitest";
import { parseRecipeJsonLd } from "./jsonld";

/** Real-world JSON-LD shapes we care about — drawn from a sample of
 *  the actual structures NYT Cooking, Bon Appétit, Serious Eats, and
 *  AllRecipes emit. Each test pins one robustness invariant against
 *  the parser. */

function wrap(jsonLd: object): string {
  return `<!doctype html><html><head>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head><body><h1>not the source of truth</h1></body></html>`;
}

describe("parseRecipeJsonLd — happy path", () => {
  it("extracts a top-level Recipe with string ingredients + string instructions", () => {
    const r = parseRecipeJsonLd(
      wrap({
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: "Bolognese",
        recipeIngredient: ["500 g ground beef", "1 onion, diced"],
        recipeInstructions: "Brown the beef.\nAdd the onion.",
      }),
    );
    expect(r).not.toBeNull();
    expect(r?.name).toBe("Bolognese");
    expect(r?.ingredients).toEqual(["500 g ground beef", "1 onion, diced"]);
    expect(r?.instructions).toEqual(["Brown the beef.", "Add the onion."]);
  });

  it("extracts a Recipe nested inside an @graph wrapper", () => {
    const r = parseRecipeJsonLd(
      wrap({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebPage", name: "Some article" },
          {
            "@type": "Recipe",
            name: "Carbonara",
            recipeIngredient: ["Pasta", "Guanciale", "Pecorino"],
            recipeInstructions: [
              { "@type": "HowToStep", text: "Cook pasta." },
              { "@type": "HowToStep", text: "Render guanciale." },
            ],
          },
        ],
      }),
    );
    expect(r?.name).toBe("Carbonara");
    expect(r?.ingredients).toEqual(["Pasta", "Guanciale", "Pecorino"]);
    expect(r?.instructions).toEqual(["Cook pasta.", "Render guanciale."]);
  });

  it("handles HowToSection containing nested HowToSteps", () => {
    const r = parseRecipeJsonLd(
      wrap({
        "@type": "Recipe",
        name: "Layered cake",
        recipeIngredient: ["Flour"],
        recipeInstructions: [
          {
            "@type": "HowToSection",
            name: "Sponge",
            itemListElement: [
              { "@type": "HowToStep", text: "Mix dry." },
              { "@type": "HowToStep", text: "Fold in eggs." },
            ],
          },
          {
            "@type": "HowToSection",
            itemListElement: [{ "@type": "HowToStep", text: "Whip cream." }],
          },
        ],
      }),
    );
    expect(r?.instructions).toEqual([
      "Mix dry.",
      "Fold in eggs.",
      "Whip cream.",
    ]);
  });

  it("handles ingredient objects with a name field", () => {
    const r = parseRecipeJsonLd(
      wrap({
        "@type": "Recipe",
        name: "Soup",
        recipeIngredient: [
          { name: "1 cup stock" },
          { name: "2 carrots" },
          { name: "" }, // empty → dropped
        ],
        recipeInstructions: [],
      }),
    );
    expect(r?.ingredients).toEqual(["1 cup stock", "2 carrots"]);
  });

  it("scans multiple ld+json blocks and picks the Recipe one", () => {
    // Many sites emit one block per schema type; we must scan all.
    const html = `<!doctype html>
<script type="application/ld+json">${JSON.stringify({ "@type": "BreadcrumbList", itemListElement: [] })}</script>
<script type="application/ld+json">${JSON.stringify({ "@type": "Organization", name: "Foo Magazine" })}</script>
<script type="application/ld+json">${JSON.stringify({
      "@type": "Recipe",
      name: "Found it",
      recipeIngredient: ["egg"],
      recipeInstructions: "step",
    })}</script>`;
    const r = parseRecipeJsonLd(html);
    expect(r?.name).toBe("Found it");
  });

  it("accepts @type as an array (Recipe sometimes co-typed with NewsArticle)", () => {
    const r = parseRecipeJsonLd(
      wrap({
        "@type": ["NewsArticle", "Recipe"],
        name: "Co-typed",
        recipeIngredient: ["X"],
        recipeInstructions: "Y",
      }),
    );
    expect(r?.name).toBe("Co-typed");
  });

  it("extracts optional cuisine + yield + total time when present", () => {
    const r = parseRecipeJsonLd(
      wrap({
        "@type": "Recipe",
        name: "Pad Thai",
        recipeIngredient: ["Rice noodles"],
        recipeInstructions: "Cook.",
        recipeCuisine: "Thai",
        recipeYield: "2 servings",
        totalTime: "PT30M",
      }),
    );
    expect(r?.cuisine).toBe("Thai");
    expect(r?.yieldText).toBe("2 servings");
    // The parser humanizes ISO 8601 durations so the UI never has
    // to display the raw PTxxM form.
    expect(r?.totalTime).toBe("30 min");
  });
});

describe("parseRecipeJsonLd — HTML entity decoding", () => {
  it("decodes HTML entities in ingredient strings (the &frac34; bug)", () => {
    // Real-world: giallozafferano.com leaks `&frac34;` into JSON-LD
    // because their template auto-generates from HTML-encoded
    // article text. Without decoding here, the user sees the raw
    // entity in the preview AND in the form's pre-filled notes.
    const r = parseRecipeJsonLd(
      wrap({
        "@type": "Recipe",
        name: "Eggplant rolls",
        recipeIngredient: [
          "Tomato pur&eacute;e &frac34; cup",
          "Salt &amp; pepper to taste",
          "&frac12; tsp baking soda",
        ],
        recipeInstructions: "Mix everything &mdash; carefully.",
      }),
    );
    expect(r?.ingredients).toEqual([
      "Tomato purée ¾ cup",
      "Salt & pepper to taste",
      "½ tsp baking soda",
    ]);
    expect(r?.instructions[0]).toBe("Mix everything — carefully.");
  });

  it("decodes entities in name + cuisine + yield", () => {
    const r = parseRecipeJsonLd(
      wrap({
        "@type": "Recipe",
        name: "Caf&eacute; cake",
        recipeIngredient: ["X"],
        recipeInstructions: "Y",
        recipeCuisine: "Caf&eacute;",
        recipeYield: "&frac12; pan (4 servings)",
      }),
    );
    expect(r?.name).toBe("Café cake");
    expect(r?.cuisine).toBe("Café");
    expect(r?.yieldText).toBe("½ pan (4 servings)");
  });

  it("decodes entities in HowToStep text", () => {
    const r = parseRecipeJsonLd(
      wrap({
        "@type": "Recipe",
        name: "Steps",
        recipeIngredient: [],
        recipeInstructions: [
          { "@type": "HowToStep", text: "Add &frac14; tsp salt." },
          { "@type": "HowToStep", text: "Wait 5 sec &hellip;" },
        ],
      }),
    );
    expect(r?.instructions).toEqual(["Add ¼ tsp salt.", "Wait 5 sec …"]);
  });
});

describe("parseRecipeJsonLd — failure / degenerate cases", () => {
  it("returns null when no JSON-LD blocks exist", () => {
    const r = parseRecipeJsonLd(
      "<!doctype html><html><body>just text</body></html>",
    );
    expect(r).toBeNull();
  });

  it("returns null when JSON-LD exists but no Recipe is present", () => {
    const r = parseRecipeJsonLd(
      wrap({ "@type": "Article", name: "Not a recipe" }),
    );
    expect(r).toBeNull();
  });

  it("ignores malformed JSON in a block and keeps scanning subsequent ones", () => {
    const html = `<!doctype html>
<script type="application/ld+json">{ broken: json, here</script>
<script type="application/ld+json">${JSON.stringify({
      "@type": "Recipe",
      name: "Saved by the next block",
      recipeIngredient: [],
      recipeInstructions: [],
    })}</script>`;
    const r = parseRecipeJsonLd(html);
    expect(r?.name).toBe("Saved by the next block");
  });

  it("falls back to 'Untitled recipe' when name is missing", () => {
    const r = parseRecipeJsonLd(
      wrap({
        "@type": "Recipe",
        recipeIngredient: ["x"],
        recipeInstructions: "y",
      }),
    );
    expect(r?.name).toBe("Untitled recipe");
  });
});
