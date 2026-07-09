/**
 * ESLint rule: require-aal2-gate
 *
 * Any API route under `app/api/**\/route.ts` that calls
 * `supabase.auth.getUser()` MUST also call `assertAal2(...)` or
 * `requireAdmin(...)`. Both helpers enforce AAL2; calling neither
 * means the route accepts an AAL1-only session, which is the bypass
 * we closed in the 2026-05 MFA hardening round.
 *
 * Background: twice in a single session, an IDE auto-import sorter
 * silently dropped the `assertAal2` import — and with it the gate
 * call when the variable went unused. Both regressions reintroduced
 * the bypass on a live AI route (`recipes/generate`, then
 * `meal-plan`) and were only caught by a manual sweep. This rule
 * catches the next one at lint time.
 *
 * What triggers it:
 *   - Route file calls `<anything>.auth.getUser()`
 *   - AND does NOT call any of: `assertAal2`, `requireAdmin`
 *
 * What does NOT trigger it:
 *   - Public routes that don't authenticate (no `getUser` call).
 *   - Routes using service-role/CRON_SECRET/webhook signatures
 *     (no per-user auth check).
 *   - Files on the small ALLOWLIST below — routes where calling
 *     `assertAal2` would be wrong (called during MFA itself, or
 *     deliberately accept anonymous callers).
 *
 * The allowlist is hardcoded rather than supporting an inline
 * `eslint-disable` because the project's AGENTS.md forbids
 * `eslint-disable` suppressions. Each allowlisted route is a
 * deliberate design choice with a documented reason; this rule
 * mirrors that.
 */

const ALLOWLIST = [
  // Called DURING MFA verification to decide whether this device
  // can skip the prompt. Asserting AAL2 here would create a
  // chicken-and-egg loop (you need AAL2 to check whether you can
  // skip the AAL2 prompt).
  "auth/mfa/trusted-devices/check/route.ts",
  // Public contact form — accepts anonymous submissions; an
  // authenticated user attaches their email for context only.
  // Blocking AAL1 here would be hostile to users trying to ask
  // for help.
  "support/route.ts",
  // Lost-authenticator step-down. By definition the caller CAN'T reach
  // AAL2 (their authenticator is gone), so assertAal2 would make recovery
  // impossible — the same chicken-and-egg as the trusted-devices check.
  // Authorization here is the single-use recovery grant (`consumeRecoveryGrant`),
  // which proves backup-inbox control; see the route's SECURITY note and
  // migration 0067.
  "account/mfa/recover-unenroll/route.ts",
];

const GATE_FUNCTIONS = new Set([
  "assertAal2",
  "assertFreshAal2",
  "requireAdmin",
]);

function isOnAllowlist(filename) {
  // Normalize path separators so the rule works the same on Windows.
  const normalized = filename.replace(/\\/g, "/");
  return ALLOWLIST.some((suffix) => normalized.endsWith(`/${suffix}`));
}

/** Detect `<expr>.auth.getUser()` — `<expr>` is typically `supabase`
 *  or `cookieClient` but the rule deliberately doesn't pin the
 *  receiver name. The auth-helper chain is what matters. */
function isAuthGetUserCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "getUser" &&
    node.callee.object.type === "MemberExpression" &&
    node.callee.object.property.type === "Identifier" &&
    node.callee.object.property.name === "auth"
  );
}

/** Detect a bare-name call to one of the gate helpers. We don't
 *  require it to be on a specific import path because the function
 *  name itself is distinctive — anyone shadowing `assertAal2` with
 *  a local function would be a much larger problem this rule
 *  isn't trying to catch. */
function isGateCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    GATE_FUNCTIONS.has(node.callee.name)
  );
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "API routes that authenticate the caller must also assert AAL2 (MFA) via assertAal2 or requireAdmin.",
    },
    schema: [],
    messages: {
      missingGate:
        "This route calls `auth.getUser()` but never calls `assertAal2()`, `assertFreshAal2()`, or `requireAdmin()`. Add a gate check immediately after the user lookup — otherwise an AAL1-only session can call this route. See lib/auth/mfa-required.ts.",
    },
  },
  create(context) {
    const filename = context.filename;
    // Scope: only `app/api/**/route.ts` (skip tests + non-route
    // files). The test suffix check is belt-and-braces; tests
    // shouldn't even contain route bodies.
    if (!/\/app\/api\/.+\/route\.ts$/.test(filename.replace(/\\/g, "/"))) {
      return {};
    }
    if (isOnAllowlist(filename)) return {};

    let getUserNode = null;
    let hasGate = false;

    return {
      CallExpression(node) {
        if (!getUserNode && isAuthGetUserCall(node)) {
          getUserNode = node;
          return;
        }
        if (!hasGate && isGateCall(node)) {
          hasGate = true;
        }
      },
      "Program:exit"() {
        if (getUserNode && !hasGate) {
          context.report({ node: getUserNode, messageId: "missingGate" });
        }
      },
    };
  },
};

export default rule;
