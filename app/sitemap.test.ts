import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app-url", () => ({
  getAppUrl: vi.fn(() => "https://maqro.app"),
}));

describe("sitemap", () => {
  it("includes the public marketing routes with the canonical base", async () => {
    const { default: sitemap } = await import("./sitemap");
    const entries = sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls).toContain("https://maqro.app/");
    expect(urls).toContain("https://maqro.app/login");
    expect(urls).toContain("https://maqro.app/help");
    expect(urls).toContain("https://maqro.app/privacy");
    expect(urls).toContain("https://maqro.app/terms");
  });

  it("does not leak gated routes (app, admin, api)", async () => {
    const { default: sitemap } = await import("./sitemap");
    const urls = sitemap().map((e) => e.url);
    expect(urls.some((u) => u.includes("/app"))).toBe(false);
    expect(urls.some((u) => u.includes("/admin"))).toBe(false);
    expect(urls.some((u) => u.includes("/api"))).toBe(false);
  });

  it("ranks the landing as priority 1.0", async () => {
    const { default: sitemap } = await import("./sitemap");
    const root = sitemap().find((e) => e.url === "https://maqro.app/");
    expect(root?.priority).toBe(1.0);
  });
});

describe("robots", () => {
  it("allows '/' for all user agents", async () => {
    const { default: robots } = await import("./robots");
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule?.userAgent).toBe("*");
    expect(rule?.allow).toBe("/");
  });

  it("does NOT enumerate sensitive paths via Disallow", async () => {
    // Listing `/admin/`, `/api/`, etc. in robots.txt is an info-
    // disclosure anti-pattern — it advertises the surface area to
    // any reconnaissance script. Real access control lives in
    // route handlers, middleware, and BotID. This assertion is the
    // forcing function: a future contributor adding a Disallow
    // list fails the test and has to read the file's header
    // comment before re-shipping the leak.
    const { default: robots } = await import("./robots");
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule?.disallow).toBeUndefined();
  });

  it("points at the canonical sitemap", async () => {
    const { default: robots } = await import("./robots");
    expect(robots().sitemap).toBe("https://maqro.app/sitemap.xml");
  });
});
