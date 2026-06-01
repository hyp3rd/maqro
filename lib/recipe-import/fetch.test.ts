import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRecipePage, validateUrl } from "./fetch";

/** Mock `node:dns/promises` at module-load time so every call to
 *  `dns.lookup` resolves to a publicly-routable IP unless a test
 *  overrides it. Without this, the real resolver would fire against
 *  example.com on each test run — slow, flaky, and dependent on
 *  network state. Tests that exercise the DNS-rebinding defense
 *  override per-call. */
const dnsMock = vi.hoisted(() => ({
  lookup: vi.fn() as ReturnType<typeof vi.fn>,
}));
vi.mock("node:dns/promises", () => ({
  default: dnsMock,
  lookup: dnsMock.lookup,
}));

/** Hoisted mock of the global fetch so tests don't hit the network.
 *  Each test sets fetchMock.mockResolvedValueOnce(...) to drive the
 *  response shape; beforeEach/afterEach below swap it in/out of
 *  globalThis.fetch. */
const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn() as ReturnType<typeof vi.fn>,
}));

/** SSRF gate tests. The point of this file is to nail down every
 *  shape the validator must reject. Any new private-IP range that
 *  ever lands in the validator needs a matching test or it'll quietly
 *  rot in the wrong direction. */
describe("validateUrl", () => {
  it("accepts a normal https URL", () => {
    const r = validateUrl("https://cooking.nytimes.com/recipes/12345");
    expect(r.ok).toBe(true);
  });

  it("rejects plain http:// (HTTPS-only, see fetch.ts comment)", () => {
    // Tightened to defeat redirect-injection MITM and so the TLS cert
    // chain stays available as a defense against DNS rebinding.
    const r = validateUrl("http://example.com/recipe");
    expect(r.ok).toBe(false);
  });

  it("rejects non-https schemes", () => {
    expect(validateUrl("ftp://example.com/file").ok).toBe(false);
    expect(validateUrl("file:///etc/passwd").ok).toBe(false);
    expect(validateUrl("javascript:alert(1)").ok).toBe(false);
    expect(validateUrl("gopher://example.com/").ok).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(validateUrl("not a url").ok).toBe(false);
    expect(validateUrl("").ok).toBe(false);
  });

  // The IP-literal tests use https:// so we're verifying the IP-range
  // gate, not just the scheme gate. A passing https + private-IP test
  // proves the SSRF defense, while http+private-IP would only prove
  // the scheme block.
  it("rejects localhost / loopback names", () => {
    expect(validateUrl("https://localhost/").ok).toBe(false);
    expect(validateUrl("https://app.localhost/").ok).toBe(false);
  });

  it("rejects IPv4 loopback (127.0.0.0/8)", () => {
    expect(validateUrl("https://127.0.0.1/").ok).toBe(false);
    expect(validateUrl("https://127.10.0.1/").ok).toBe(false);
  });

  it("rejects RFC1918 private ranges", () => {
    expect(validateUrl("https://10.0.0.1/").ok).toBe(false);
    expect(validateUrl("https://172.16.0.1/").ok).toBe(false);
    expect(validateUrl("https://172.31.255.255/").ok).toBe(false);
    expect(validateUrl("https://192.168.1.1/").ok).toBe(false);
  });

  it("rejects link-local + cloud metadata (169.254/16)", () => {
    expect(validateUrl("https://169.254.169.254/").ok).toBe(false);
  });

  it("rejects 0.0.0.0/8 and ::", () => {
    expect(validateUrl("https://0.0.0.0/").ok).toBe(false);
    expect(validateUrl("https://[::1]/").ok).toBe(false);
    expect(validateUrl("https://[::]/").ok).toBe(false);
  });

  it("rejects IPv6 link-local + ULA ranges", () => {
    expect(validateUrl("https://[fe80::1]/").ok).toBe(false);
    expect(validateUrl("https://[fc00::1]/").ok).toBe(false);
  });

  it("accepts public IPv4 (1.1.1.1)", () => {
    // Cloudflare's resolver — public, fine for the parser to fetch.
    const r = validateUrl("https://1.1.1.1/");
    expect(r.ok).toBe(true);
  });
});

/** Redirect-revalidation tests. The point of these is to ensure
 *  the manual redirect loop closes the SSRF gap that
 *  `redirect: "follow"` would leave open. We swap the global
 *  `fetch` for our mock so the production code (which calls the
 *  bare `fetch`) hits the stub instead of the network. */
describe("fetchRecipePage — redirect handling", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    // Default DNS lookup: every hostname resolves to a public IP.
    // The dedicated "DNS defense" suite below overrides this to
    // exercise the rebinding-detection path.
    dnsMock.lookup.mockReset();
    dnsMock.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    fetchMock.mockReset();
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function makeRedirect(location: string, status = 302): Response {
    return new Response(null, { status, headers: { location } });
  }
  function makePage(body: string): Response {
    // fetchRecipePage tracks the URL itself (via `currentUrl`); the
    // Response object's url field is read-only and unused.
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }

  it("rejects a redirect to a private IP (SSRF defense)", async () => {
    fetchMock.mockResolvedValueOnce(
      makeRedirect("http://169.254.169.254/meta"),
    );

    const result = await fetchRecipePage("https://example.com/recipe");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Redirect blocked/i);
    }
  });

  it("follows a public-to-public redirect chain", async () => {
    fetchMock
      .mockResolvedValueOnce(makeRedirect("https://example.com/recipe/final"))
      .mockResolvedValueOnce(makePage("<html>recipe content</html>"));

    const result = await fetchRecipePage("https://example.com/recipe");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toContain("recipe content");
      expect(result.finalUrl).toBe("https://example.com/recipe/final");
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("resolves relative Location headers against the current URL", async () => {
    fetchMock
      .mockResolvedValueOnce(makeRedirect("/recipes/v2"))
      .mockResolvedValueOnce(makePage("<html>v2</html>"));

    const result = await fetchRecipePage("https://example.com/recipes/v1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalUrl).toBe("https://example.com/recipes/v2");
    }
  });

  it("bails after MAX_REDIRECTS hops to defeat redirect-loop attacks", async () => {
    // Always redirect; the loop must give up after the bound.
    fetchMock.mockResolvedValue(makeRedirect("https://example.com/loop"));

    const result = await fetchRecipePage("https://example.com/loop");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Redirect chain exceeded/i);
    }
  });

  it("returns 4xx/5xx origin errors without attempting to follow", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    const result = await fetchRecipePage("https://example.com/missing");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });

  it("rejects a 3xx without a Location header", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));
    const result = await fetchRecipePage("https://example.com/x");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Location header/i);
    }
  });
});

/** DNS-rebinding defense tests. The string-validation gate only
 *  catches IP literals; a public hostname whose A-record points at
 *  a private IP still has to be detected at the DNS-resolution
 *  layer. These tests pin the resolver-level check that runs before
 *  every fetch hop. */
describe("fetchRecipePage — DNS-level SSRF defense", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    dnsMock.lookup.mockReset();
    fetchMock.mockReset();
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("rejects a hostname whose A-record points at the cloud metadata IP", async () => {
    // attacker.com validates as a hostname (public-looking) but
    // resolves to 169.254.169.254 — the classic DNS rebinding shape
    // targeting AWS/GCP/Azure instance metadata.
    dnsMock.lookup.mockResolvedValueOnce([
      { address: "169.254.169.254", family: 4 },
    ]);

    const result = await fetchRecipePage("https://attacker.example/path");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/non-public IP/i);
    }
    // Critical assertion: fetch is NEVER called if DNS check fails.
    // Otherwise the SSRF defense is theatre.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when ANY resolved address is private (mixed A-records)", async () => {
    // Some DNS rebinding setups serve a mixed result set hoping the
    // runtime picks the private one. We reject the whole set if any
    // address in it is private.
    dnsMock.lookup.mockResolvedValueOnce([
      { address: "1.2.3.4", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);

    const result = await fetchRecipePage("https://mixed.example/path");
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when DNS resolution itself fails (NXDOMAIN, network)", async () => {
    dnsMock.lookup.mockRejectedValueOnce(new Error("ENOTFOUND"));

    const result = await fetchRecipePage("https://nonexistent.example/path");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/resolve/i);
    }
  });

  it("rejects when DNS returns an empty record set", async () => {
    dnsMock.lookup.mockResolvedValueOnce([]);

    const result = await fetchRecipePage("https://empty.example/path");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/A\/AAAA/);
    }
  });

  it("rejects IPv6 ULA addresses from resolution", async () => {
    dnsMock.lookup.mockResolvedValueOnce([{ address: "fd00::1", family: 6 }]);
    const result = await fetchRecipePage("https://v6.example/path");
    expect(result.ok).toBe(false);
  });

  it("rejects IPv4-mapped IPv6 that wraps a private v4 (::ffff:10.0.0.1)", async () => {
    dnsMock.lookup.mockResolvedValueOnce([
      { address: "::ffff:10.0.0.1", family: 6 },
    ]);
    const result = await fetchRecipePage("https://mapped.example/path");
    expect(result.ok).toBe(false);
  });

  it("re-runs the DNS check on every redirect hop", async () => {
    // First hop: public hostname resolves clean → fetched, 302s.
    // Second hop: hostname resolves to private → must be blocked
    // even though the URL string itself looks public.
    dnsMock.lookup
      .mockResolvedValueOnce([{ address: "1.2.3.4", family: 4 }])
      .mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://internal.example/leak" },
      }),
    );

    const result = await fetchRecipePage("https://public.example/x");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/non-public IP/i);
    }
    // Only the first hop's fetch should fire; the second is gated
    // by the DNS check that fails.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips DNS resolution when the host is already an IP literal", async () => {
    // IP literals were already range-checked by validateUrl. dns.lookup
    // on an IP just echoes it back; calling it is wasted work and
    // would also let a buggy mock derail the test.
    dnsMock.lookup.mockRejectedValue(
      new Error("dns.lookup should not have been called"),
    );
    fetchMock.mockResolvedValueOnce(
      new Response("<html>page</html>", { status: 200 }),
    );

    const result = await fetchRecipePage("https://93.184.216.34/path");
    expect(result.ok).toBe(true);
    expect(dnsMock.lookup).not.toHaveBeenCalled();
  });
});
