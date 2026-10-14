import { readWithCap } from "@/lib/http/read-with-cap";
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
 *  With `maxBytes`, an oversized body is refused with `413` first.
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
 *    - Centralized place for cross-cutting concerns: request-size
 *      limits (`maxBytes`) today; content-type assertion or telemetry
 *      later.
 *    - Pairs with the `maqro/require-aal2-gate` ESLint rule as
 *      defense-in-depth: that rule covers auth; this covers input. */
export type ParseBodyResult<T> =
  { ok: true; data: T } | { ok: false; response: NextResponse };

export type ParseBodyOptions = {
  /** Reject bodies larger than this many bytes with 413, before any JSON
   *  parsing. A declared `Content-Length` over the limit is refused without
   *  reading; otherwise the stream is read up to the limit and abandoned
   *  past it, so a chunked upload can't slip by. Routes that forward input
   *  to a paid model set this; omitted, the body is read unbounded. */
  maxBytes?: number;
};

function invalidJson(): ParseBodyResult<never> {
  return {
    ok: false,
    response: NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    ),
  };
}

function bodyTooLarge(maxBytes: number): ParseBodyResult<never> {
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: `Request body too large. Max ${Math.floor(maxBytes / 1024)} KB.`,
      },
      { status: 413 },
    ),
  };
}

export async function parseBody<T>(
  req: Request,
  schema: ZodType<T>,
  opts: ParseBodyOptions = {},
): Promise<ParseBodyResult<T>> {
  let raw: unknown;
  if (opts.maxBytes === undefined) {
    try {
      raw = await req.json();
    } catch {
      return invalidJson();
    }
  } else {
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > opts.maxBytes) {
      return bodyTooLarge(opts.maxBytes);
    }
    const read = await readWithCap(req.body, opts.maxBytes);
    if (!read.ok) return bodyTooLarge(opts.maxBytes);
    try {
      raw = JSON.parse(read.text);
    } catch {
      return invalidJson();
    }
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
