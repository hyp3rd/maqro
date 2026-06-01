import requireAal2Gate from "./require-aal2-gate.js";

/** Maqro custom ESLint rules. Plugin id is "maqro" — rules are
 *  referenced as `maqro/<rule-name>` in the flat config.
 *
 *  Add a new rule by importing it at the top and registering it
 *  in the `rules` map. Keep the surface tiny: a custom rule that
 *  doesn't catch a concrete, repeating defect is dead weight. */
export const maqroPlugin = {
  meta: { name: "maqro", version: "0.1.0" },
  rules: { "require-aal2-gate": requireAal2Gate },
};
