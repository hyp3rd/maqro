/** Canonical list of meal-plan refiner pills shown under a generated
 *  plan. Each pill is a single-shot adjustment the user can ask the AI
 *  to apply to the *current* plan — they're not stacked or persistent;
 *  clicking re-runs the planner with the pill's `text` appended to the
 *  prompt and the previous meals supplied as starting context.
 *
 *  Keeping these as a constant (rather than inline in MealPlanner) so
 *  the route can validate against the same list if we later decide to
 *  reject arbitrary free text, and so the labels are easy to localize
 *  in one place. */
export type Refiner = {
  /** Stable identifier for telemetry / future "sticky pill" UI. */
  id: string;
  /** Short label shown on the pill itself. */
  label: string;
  /** Full instruction the AI sees in the user message. Written in
   *  imperative voice so it reads naturally appended to the existing
   *  system prompt. */
  text: string;
};

export const REFINERS: ReadonlyArray<Refiner> = [
  {
    id: "less-sugar",
    label: "Lower sugars",
    text: "Reduce added sugars and high-sugar foods (sweets, sweetened drinks, sugary cereals). Prefer whole-fruit carbs over juice or jam.",
  },
  {
    id: "less-carbs",
    label: "Less carbs",
    text: "Reduce total carbohydrates by roughly 20%. Keep protein on target; let calories drop accordingly rather than backfilling with fat.",
  },
  {
    id: "less-cals",
    label: "Lower calories",
    text: "Trim total calories by roughly 10%. Keep protein on or above target; reduce fat and carbs proportionally.",
  },
  {
    id: "celiac",
    label: "Adapt for celiacs",
    text: "Replace every gluten-containing food with a naturally gluten-free alternative. Gluten sources to avoid: wheat, barley, rye, spelt, kamut, semolina, durum, couscous, regular bread, regular pasta, regular oats (unless explicitly labelled gluten-free), bulgur, farro, beer, soy sauce containing wheat.",
  },
  {
    id: "fat-loss",
    label: "Optimize for fat loss",
    text: "Adjust this plan to better support fat loss while preserving the meal structure and respecting the user's existing calorie target. Bias the food choices toward: (a) higher per-meal protein from lean sources (chicken breast, white fish, egg whites, low-fat dairy, legumes, tofu); (b) high-volume, low-energy-density vegetables to increase satiety; (c) slower-digesting carbs (oats, brown rice, lentils, sweet potato) over refined ones (white bread, sugary cereals); (d) reduced added sugars and refined-flour items; (e) limited saturated fat. Don't drop calories below the target — the user has set their deficit elsewhere. Keep the meal count and slot names unchanged.",
  },
  {
    id: "pre-diabetic",
    label: "Adapt for pre-diabetics",
    text: "Adjust this plan for someone managing pre-diabetes / supporting healthy blood-glucose response. Prioritize: (a) lower-glycemic-index carbs (oats, lentils, beans, quinoa, non-starchy vegetables) over high-GI ones (white bread, sugary cereals, white rice, fruit juice, sweets); (b) distributing carbohydrate roughly evenly across the day's meals rather than concentrating it in one slot, to flatten post-meal glucose excursions; (c) pairing every carb-containing meal with protein AND fiber to slow gastric emptying; (d) reducing added sugars to near zero; (e) keeping fruit choices to whole fruit (lower-GI: berries, apples, pears) rather than juices or dried fruit. Preserve the user's calorie and macro targets and the meal slot count.",
  },
] as const;
