import { NextResponse } from "next/server";
import type { ZodType } from "zod";

/** Parse + validate an API route's JSON body against a Zod schema.
 *
 *  Returns a discriminated union so callers can short-circuit on
 *  failure without juggling try/catch:
 *
 *    const parsed = await parseBody(req, BodySchema);
 *    if (!parsed.ok) return parsed.response;
 *    // parsed.data is fully typed here
 *
 *  Failure modes the helper folds into one `400` response:
 *    - Body is not valid JSON (the `req.json()` throw)
 *    - Body parses but doesn't match the schema (Zod's flat error)
 *
 *  Both produce a JSON envelope with a top-level `error` (human-
 *  readable) and an optional `fields` map (per-field issues from
 *  Zod's `flatten()`). The shape mirrors the existing convention in
 *  the codebase (`{ error: string }`) so existing callers don't
 *  need to be rewritten — `fields` is purely additive.
 *
 *  Why one helper instead of per-route ad hoc parsing:
 *    - Consistent 400 envelope means client toasts look the same
 *      everywhere; no surprise undefined-field crashes mid-route.
 *    - Centralized place to add cross-cutting concerns later
 *      (request-size limits, content-type assertion, telemetry).
 *    - Pairs with the `maqro/require-aal2-gate` ESLint rule as
 *      defense-in-depth: that rule covers auth; this covers input. */
export type ParseBodyResult<T> =
  { ok: true; data: T } | { ok: false; response: NextResponse };

export async function parseBody<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<ParseBodyResult<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400 },
      ),
    };
  }

  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };

  // Zod 4: `.flatten()` returns `{ formErrors, fieldErrors }`.
  // We surface fieldErrors (per-key issues) since that's the
  // signal callers can use to point UX at specific inputs; the
  // top-level message is built from the first issue for a useful
  // single-line summary in toast UIs that ignore `fields`.
  const flat = parsed.error.flatten();
  const firstIssue = parsed.error.issues[0];
  const summary = firstIssue
    ? buildSummary(firstIssue.path, firstIssue.message)
    : "Invalid request body.";

  return {
    ok: false,
    response: NextResponse.json(
      { error: summary, fields: flat.fieldErrors },
      { status: 400 },
    ),
  };
}

/** Build a one-line "fieldName: message" summary. Path may be empty
 *  (a top-level schema error like "Expected object, got string"), in
 *  which case we drop the prefix. */
function buildSummary(
  path: ReadonlyArray<PropertyKey>,
  message: string,
): string {
  if (path.length === 0) return message;
  return `${path.join(".")}: ${message}`;
}
