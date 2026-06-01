import next from "eslint-config-next";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { maqroPlugin } from "./eslint-rules/index.js";

const eslintConfig = [
  ...next,
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "react/no-unescaped-entities": "off",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
    },
  },
  {
    // In test files, non-null assertions after an explicit null-check
    // (e.g. `expect(x).not.toBeNull(); x!.foo`) are idiomatic and clearer
    // than wrapping every line in an `if (x)`.
    files: ["**/*.test.ts", "**/*.test.tsx", "tests/**/*.ts", "tests/**/*.tsx"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    // Maqro custom rules — scoped to API routes. Currently one rule:
    // `require-aal2-gate` catches the regression where an auth-import
    // sorter drops `assertAal2` from a route that calls `getUser`.
    files: ["app/api/**/route.ts"],
    ignores: ["app/api/**/route.test.ts"],
    plugins: { maqro: maqroPlugin },
    rules: { "maqro/require-aal2-gate": "error" },
  },
];

export default eslintConfig;
