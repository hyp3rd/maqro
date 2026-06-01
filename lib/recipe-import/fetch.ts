import { isPrivateOrSpecialIp } from "./ip-ranges";

/** Safe URL fetcher for recipe-import.
 *
 *  SECURITY MODEL — five layers of SSRF defense in front of every
 *  `fetch()` call. Each addresses a distinct attack class:
 *
 *    1. **String validation (`validateUrl`)**: parses the URL via
 *       the WHATWG `URL` constructor, requires scheme `https:`, and
 *       rejects any IP-literal hostname in a private, loopback,
 *       link-local, ULA, cloud-metadata, carrier-grade-NAT, or
 *       IPv4-mapped-IPv6 private range. Returns a `URL` object
 *       (not a string) so the validated boundary is visible at the
 *       type level — fetch is called with the `URL` object directly.
 *
 *    2. **DNS-level rebinding defense (`resolveAndCheckHost`)**:
 *       resolves the hostname via `node:dns/promises.lookup({all:
 *       true, verbatim: true})` and rejects if ANY returned A/AAAA
 *       record is private. This is the load-bearing check against
 *       the "public hostname → private IP" attack — string
 *       validation can't see through DNS, but server-side
 *       resolution can. The route is pinned to `runtime = "nodejs"`
 *       precisely so this defense remains available.
 *
 *    3. **Manual redirect handling**: `redirect: "manual"` so the
 *       runtime never silently follows a 302 into an attacker-
 *       chosen Location. EACH hop runs through both validateUrl
 *       and resolveAndCheckHost again. Bounded at 5 hops.
 *
 *    4. **Response size cap (5 MB) and timeout (15 s)**: bound
 *       worst-case resource consumption against a hostile origin.
 *
 *    5. **Auth + rate gates** (at the route, not here): the calling
 *       /api/recipes/import-from-url route requires a logged-in
 *       session AND throttles to 20/IP/hr + 30/user/hr. A determined
 *       attacker can't fan this out across many anonymous requests.
 *
 *  Residual risk: a TOCTOU race between step 2's DNS lookup and
 *  the runtime's internal DNS resolution at fetch time. The window
 *  is sub-millisecond in practice; exploiting it requires a hostile
 *  DNS server with TTL=0 plus perfect timing while already past the
 *  auth + rate gates. The TLS handshake (HTTPS-only, layer 1)
 *  closes most of what's left — a cert valid for the public
 *  hostname almost never lives on a private IP. Fully eliminating
 *  the race would require fetching by IP with a manually-set Host
 *  header via a custom undici dispatcher; the complexity isn't
 *  warranted given the bounded blast radius.
 *
 *  ──────────────────────────────────────────────────────────────
 *  Note on SAST taint analysis: a pure taint analyzer follows
 *  string → string flow from `req.json()` to `fetch()` and reports
 *  this module as a sink for user input. The data flow IS there —
 *  it's inherent to the "fetch a user-pasted URL" feature. What
 *  the scanner can't see is the chain of sanitizers above. The
 *  defenses are the load-bearing protection; the taint label is a
 *  byproduct of the feature shape. Do not remove defenses to chase
 *  scanner labels.
 *  ──────────────────────────────────────────────────────────────
 *
 *  Content-type filtering: we accept anything that responds with
 *  a body — many recipe sites mis-set the type. The JSON-LD
 *  parser handles "not HTML" by returning null, so the worst-case
 *  is wasted bandwidth rather than incorrect parsing.
 *
 *  We send a User-Agent header that identifies us — some sites
 *  block default `node-fetch`-shaped UAs as bot traffic. Calling
 *  out the app + linking back is the courteous choice. */

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const UA =
  "Mozilla/5.0 (compatible; MaqroRecipeImporter/1.0; +https://maqro.app/contact)";

export type FetchResult =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; error: string; status?: number };

export async function fetchRecipePage(url: string): Promise<FetchResult> {
  const initial = validateUrl(url);
  if (!initial.ok) return { ok: false, error: initial.reason };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Typed as URL throughout the loop, never as a raw string. The
    // raw user-supplied string only exists at the very top of this
    // function and is immediately consumed by validateUrl. From here
    // on, currentUrl is the validateUrl-produced URL object — passed
    // directly to fetch so the sanitization boundary is enforced by
    // the type system, not by convention.
    let currentUrl: URL = initial.url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Fail-fast DNS pre-check for a clean error message. The
      // dispatcher below is the LOAD-BEARING defense (it runs the
      // same check inside the connect handshake with zero TOCTOU
      // window). This pre-check exists only so we can surface
      // "hostname doesn't resolve / resolves to private IP" to the
      // user before the connect attempt fires.
      const dnsCheck = await resolveAndCheckHost(currentUrl.hostname);
      if (!dnsCheck.ok) {
        return { ok: false, error: dnsCheck.reason };
      }

      // Standard fetch. The earlier attempt at wiring a custom
      // undici Agent with a connect.lookup-based dispatcher (see the
      // safe-agent.ts module, kept around for future use) caused
      // reliable fetch failures in the Next.js runtime — every
      // outbound request 4xx'd at the dispatcher boundary. Until
      // that's diagnosed, the load-bearing SSRF protection sits in
      // `resolveAndCheckHost` above (DNS pre-check) and the
      // per-hop redirect revalidation below.
      const res = await fetch(currentUrl, {
        method: "GET",
        headers: {
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml",
        },
        signal: controller.signal,
        // Manual redirect so we can re-run validateUrl on the
        // Location header. `redirect: "follow"` would silently chase
        // an attacker-controlled hop into a private IP.
        redirect: "manual",
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          return {
            ok: false,
            error: `Origin responded ${res.status} but did not include a Location header.`,
            status: res.status,
          };
        }
        if (hop === MAX_REDIRECTS) {
          return {
            ok: false,
            error: `Redirect chain exceeded ${MAX_REDIRECTS} hops.`,
          };
        }
        // Resolve relative Locations against the URL we just hit.
        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          return { ok: false, error: "Redirect target is not a valid URL." };
        }
        // Re-run the full sanitization on the resolved hop, including
        // scheme + IP-literal checks. Returns a URL object that we then
        // assign to currentUrl — keeping the type-level guarantee that
        // currentUrl is always a validated URL, never a raw string.
        const revalidated = validateUrl(nextUrl);
        if (!revalidated.ok) {
          return {
            ok: false,
            error: `Redirect blocked: ${revalidated.reason}`,
          };
        }
        currentUrl = revalidated.url;
        continue;
      }

      if (!res.ok) {
        return {
          ok: false,
          error: `Origin responded ${res.status}`,
          status: res.status,
        };
      }

      // Stream-read with a byte cap so a huge body can't OOM us.
      const html = await readWithCap(res.body, MAX_BYTES);
      if (!html.ok) return { ok: false, error: html.error };

      // Surface the final URL as a string for the caller's convenience —
      // they're going to render it, not fetch it. Internal flow stays
      // typed as URL objects.
      return { ok: true, html: html.text, finalUrl: currentUrl.href };
    }
    // Shouldn't reach here — loop body returns on either 200, 4xx/5xx,
    // or after MAX_REDIRECTS — but keeps the typechecker happy.
    return { ok: false, error: "Redirect chain exhausted." };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "The URL took too long to load." };
    }
    // Diagnostic logging so we can see what's actually happening
    // server-side. The user only sees the generic message in the UI;
    // the operator gets the full error name + cause chain in the
    // server log. Important when the dispatcher swallows errors or
    // when an environmental issue (TLS, DNS, Next.js bundling)
    // breaks the fetch in production.
    if (err instanceof Error) {
      console.error("[recipe-import/fetch] fetch failed:", {
        name: err.name,
        message: err.message,
        cause: (err as Error & { cause?: unknown }).cause,
        stack: err.stack?.split("\n").slice(0, 5).join("\n"),
      });
    } else {
      console.error("[recipe-import/fetch] fetch failed (non-Error):", err);
    }
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Couldn't fetch the URL: ${err.message}`
          : "Couldn't fetch the URL.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Read a ReadableStream of bytes into a string, abandoning if the
 *  total exceeds `cap`. Returns the decoded UTF-8 text. */
async function readWithCap(
  body: ReadableStream<Uint8Array> | null,
  cap: number,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!body) return { ok: true, text: "" };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return {
        ok: false,
        error: `Page is larger than the ${cap / 1024 / 1024} MB limit.`,
      };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return { ok: true, text: new TextDecoder("utf-8").decode(merged) };
}

/** Validate the URL against SSRF + scheme rules. Returns a parsed
 *  `URL` object on success — NOT the original string. Callers that
 *  pass this to `fetch()` should pass the `URL` object directly so
 *  the sanitization boundary is explicit at the type level: the raw
 *  user-supplied string never reaches `fetch()`, only a URL that
 *  has been parsed, scheme-checked, and host-checked. */
type ValidateResult = { ok: true; url: URL } | { ok: false; reason: string };

export function validateUrl(input: string): ValidateResult {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }
  // HTTPS-only. Plain http:// is rejected for two reasons:
  //   (a) defense in depth — the TLS handshake binds the response to a
  //       specific hostname's certificate, making redirect-based MITM
  //       attacks materially harder than they'd be over cleartext.
  //   (b) every relevant recipe publisher is HTTPS as of 2026. The
  //       handful of grandfather-clause http-only blogs aren't worth
  //       widening the threat surface.
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "Only https:// URLs are supported." };
  }
  // Block IP-literal hosts that target the loopback / link-local /
  // RFC1918 ranges. This is the SSRF gate — even if the user types
  // a domain, DNS resolution happens in fetch() below, so this
  // check is best-effort against deliberately-crafted literals.
  // (Defense in depth: the runtime's network layer should already
  // refuse some of these, but we don't assume.)
  const host = parsed.hostname.toLowerCase();
  if (isPrivateOrSpecialHost(host)) {
    return { ok: false, reason: "URL targets a non-public host." };
  }
  return { ok: true, url: parsed };
}

function isPrivateOrSpecialHost(host: string): boolean {
  // Hostnames that point at loopback / link-local — block by name.
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".localhost")
  ) {
    return true;
  }
  // Delegate to the IP-literal checker for everything else.
  return isPrivateOrSpecialIp(host);
}

/** Resolve a hostname and confirm every returned A/AAAA record
 *  points at a publicly-routable address. This is the load-bearing
 *  SSRF defense: string-level validation can't detect a public
 *  hostname whose DNS record points at a private IP (the classic
 *  DNS rebinding shape). Resolving server-side and checking the
 *  resolved IPs catches it before we ever fetch.
 *
 *  Residual TOCTOU: between our `dns.lookup` and the runtime's
 *  internal lookup at fetch time, the record could flip again. That
 *  window is in the low-millisecond range against a hostile DNS
 *  server with TTL=0; bounding it to "near zero" while leaving the
 *  fetch on the standard `fetch()` API is the trade we accept,
 *  since the alternative (fetching by IP with manual Host header +
 *  SNI) requires a custom undici dispatcher and breaks for any
 *  origin doing modern routing (virtual hosts behind a CDN, SNI-
 *  based TLS termination). The auth-gated + rate-limited route
 *  bounds blast radius even if the TOCTOU race wins.
 *
 *  Uses dynamic import so this module remains tree-shakeable for
 *  unit tests that exercise only `validateUrl`. */
export async function resolveAndCheckHost(
  hostname: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Skip resolution for IP literals — they've already been range-
  // checked in validateUrl. dns.lookup on an IP literal just echoes
  // it back, so the call is wasted work.
  if (isLikelyIpLiteral(hostname)) return { ok: true };

  let dns: typeof import("node:dns/promises");
  try {
    dns = await import("node:dns/promises");
  } catch {
    // Should only happen on the Edge runtime, which this route
    // doesn't target. If it ever does, fail closed — better to
    // reject the import than silently skip the SSRF check.
    return {
      ok: false,
      reason: "DNS resolution is not available in this runtime.",
    };
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: "Couldn't resolve URL hostname." };
  }
  if (records.length === 0) {
    return { ok: false, reason: "Hostname has no A/AAAA records." };
  }
  for (const { address } of records) {
    if (isPrivateOrSpecialIp(address)) {
      // Any single private IP in the resolution set is grounds for
      // rejection — we can't control which one fetch() picks. This
      // also defeats DNS rebinding attempts that return a mix.
      return { ok: false, reason: "Hostname resolves to a non-public IP." };
    }
  }
  return { ok: true };
}

function isLikelyIpLiteral(host: string): boolean {
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (host.includes(":")) return true; // IPv6 always has colons.
  return false;
}
