import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/app-url", () => ({ getAppUrl: () => "https://maqro.app" }));

/** RFC 9116 compliance smoke-tests. We don't validate every field
 *  the spec allows, just the mandatory ones (Contact + Expires)
 *  plus the URL self-references that researchers actually verify
 *  before trusting the file. */
describe("/.well-known/security.txt", () => {
  it("serves text/plain with a 200", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
  });

  it("includes the mandatory Contact field", async () => {
    const body = await GET().text();
    expect(body).toMatch(/^Contact:\s*mailto:.+@/m);
  });

  it("includes the mandatory Expires field in ISO 8601 form", async () => {
    const body = await GET().text();
    const match = body.match(/^Expires:\s*(\S+)/m);
    expect(match).not.toBeNull();
    const expires = new Date(match?.[1] ?? "");
    expect(Number.isNaN(expires.getTime())).toBe(false);
  });

  it("sets Expires comfortably in the future", async () => {
    const body = await GET().text();
    const match = body.match(/^Expires:\s*(\S+)/m);
    const expires = new Date(match?.[1] ?? "");
    // RFC says <1 year. We aim for ~365 days; assert it's at least
    // 6 months out so a degenerate config doesn't ship a near-stale
    // file silently.
    const sixMonthsMs = 1000 * 60 * 60 * 24 * 180;
    expect(expires.getTime() - Date.now()).toBeGreaterThan(sixMonthsMs);
  });

  it("declares the canonical URL pointing at the same path", async () => {
    const body = await GET().text();
    expect(body).toContain(
      "Canonical: https://maqro.app/.well-known/security.txt",
    );
  });

  it("declares a preferred language", async () => {
    const body = await GET().text();
    expect(body).toMatch(/^Preferred-Languages:\s*en/m);
  });
});
