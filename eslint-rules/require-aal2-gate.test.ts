import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import rule from "./require-aal2-gate.js";

// RuleTester drives its own describe/it; point it at vitest's.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
});

const ROUTE = "/repo/app/api/recipes/[id]/share/route.ts";

tester.run("require-aal2-gate", rule, {
  valid: [
    {
      name: "every handler that authenticates also gates",
      filename: ROUTE,
      code: `
        export async function POST() {
          const { data: { user } } = await supabase.auth.getUser();
          const gate = await assertAal2(supabase, user);
        }
        export async function DELETE() {
          const { data: { user } } = await supabase.auth.getUser();
          const gate = await assertFreshAal2(supabase, user);
        }`,
    },
    {
      name: "a handler that never authenticates needs no gate",
      filename: ROUTE,
      code: `
        export async function GET() { return 1; }
        export const POST = async () => {
          const { data: { user } } = await supabase.auth.getUser();
          await requireAdmin();
        };`,
    },
    {
      name: "files outside app/api/**/route.ts are out of scope",
      filename: "/repo/lib/helpers.ts",
      code: `export async function f() { await supabase.auth.getUser(); }`,
    },
  ],
  invalid: [
    {
      name: "a gate in POST does not cover sibling PATCH / DELETE",
      filename: ROUTE,
      code: `
        export async function POST() {
          const { data: { user } } = await supabase.auth.getUser();
          const gate = await assertAal2(supabase, user);
        }
        export async function PATCH() {
          const { data: { user } } = await supabase.auth.getUser();
        }
        export const DELETE = async () => {
          const { data: { user } } = await supabase.auth.getUser();
        };`,
      errors: [{ messageId: "missingGate" }, { messageId: "missingGate" }],
    },
    {
      name: "a lone handler without a gate is reported",
      filename: "/repo/app/api/x/route.ts",
      code: `
        export async function GET() {
          await cookieClient.auth.getUser();
        }`,
      errors: [{ messageId: "missingGate" }],
    },
  ],
});
