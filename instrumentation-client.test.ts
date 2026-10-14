import { BOTID_PROTECTED_ROUTES } from "@/lib/botid-protected-routes";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Guards for the client instrumentation file and the BotID wiring.
 *
 *  Next.js only loads `<root>/instrumentation-client.ts` or
 *  `<root>/src/instrumentation-client.ts`. BotID's `initBotId()` once lived
 *  in `app/instrumentation-client.ts`, which Next never loads, so the client
 *  never attached its challenge headers and the server-side deep-analysis
 *  gate rejected real admins replaying failed Stripe events. */

const { mockInstallErrorCapture, mockInitBotId, mockReportClientError } =
  vi.hoisted(() => ({
    mockInstallErrorCapture: vi.fn(),
    mockInitBotId: vi.fn(),
    mockReportClientError: vi.fn(),
  }));

vi.mock("@/lib/install-error-capture", () => ({
  installErrorCapture: mockInstallErrorCapture,
}));
vi.mock("botid/client/core", () => ({ initBotId: mockInitBotId }));
vi.mock("@/lib/error-reporter", () => ({
  reportClientError: mockReportClientError,
}));

const ROOT = __dirname;
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

async function loadInstrumentation(): Promise<void> {
  vi.resetModules();
  await import("./instrumentation-client");
}

/** botid's own matcher (botid/dist/client/core): `*` becomes `.*`, the rest
 *  is escaped, and the pattern is anchored. */
function botIdPathMatches(pattern: string, pathname: string): boolean {
  const parts = pattern.replace(/[.?+^$[\]\\(){}|-]/g, "\\$&").split("*");
  return new RegExp(`^${parts.join(".*")}$`).test(pathname);
}

/** Every non-test source file under `dir`. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

type GatedHandler = { file: string; pathname: string; method: string };

/** Route handlers whose exported method body runs a BotID server check,
 *  with dynamic `[segment]`s replaced by a sample value. */
function botIdGatedHandlers(): GatedHandler[] {
  const gate = /\b(requireHumanDeep|checkBotId)\(/;
  const gated: GatedHandler[] = [];
  for (const file of sourceFiles(path.join(ROOT, "app"))) {
    // Comments may name the helpers (e.g. a route documenting a removed
    // gate); only code counts.
    const src = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    if (!gate.test(src)) continue;
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    if (!/\/route\.ts$/.test(rel)) {
      throw new Error(
        `${rel} runs a BotID check outside a route handler; extend this guard to map it to the path the client fetches.`,
      );
    }
    const pathname = rel
      .replace(/^app/, "")
      .replace(/\/route\.ts$/, "")
      .replace(/\/\([^/]+\)/g, "")
      .replace(/\[[^\]]+\]/g, "sample");
    const before = gated.length;
    for (const chunk of src.split(/export (?:async )?function /).slice(1)) {
      const method = HTTP_METHODS.find((m) => chunk.startsWith(`${m}(`));
      if (method && gate.test(chunk)) {
        gated.push({ file: rel, pathname, method });
      }
    }
    if (gated.length === before) {
      throw new Error(
        `${rel} runs a BotID check this guard cannot attribute to an exported handler function.`,
      );
    }
  }
  return gated;
}

describe("instrumentation-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lives only where Next.js loads it (no app/ or src/ copy)", () => {
    expect(existsSync(path.join(ROOT, "instrumentation-client.ts"))).toBe(true);
    for (const dir of ["app", "src"]) {
      for (const ext of ["ts", "tsx", "js", "jsx"]) {
        expect(
          existsSync(path.join(ROOT, dir, `instrumentation-client.${ext}`)),
        ).toBe(false);
      }
    }
  });

  it("arms error capture, then initializes BotID with the protected routes", async () => {
    await loadInstrumentation();
    expect(mockInstallErrorCapture).toHaveBeenCalledTimes(1);
    expect(mockInitBotId).toHaveBeenCalledTimes(1);
    expect(mockInitBotId).toHaveBeenCalledWith({
      protect: [...BOTID_PROTECTED_ROUTES],
    });
    expect(mockInstallErrorCapture.mock.invocationCallOrder[0]).toBeLessThan(
      mockInitBotId.mock.invocationCallOrder[0],
    );
  });

  it("reports a BotID init failure instead of breaking app start-up", async () => {
    const err = new Error("bad config");
    mockInitBotId.mockImplementationOnce(() => {
      throw err;
    });
    await expect(loadInstrumentation()).resolves.toBeUndefined();
    expect(mockReportClientError).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ context: { step: "initBotId" } }),
    );
  });
});

describe("BotID protect list ↔ server gates", () => {
  const gated = botIdGatedHandlers();

  it("finds the admin webhook replay gate (sanity check of the scan)", () => {
    expect(gated).toContainEqual({
      file: "app/api/admin/webhooks/[id]/replay/route.ts",
      pathname: "/api/admin/webhooks/sample/replay",
      method: "POST",
    });
  });

  it("covers every server-gated handler with a deep-analysis protect entry", () => {
    for (const h of gated) {
      const entry = BOTID_PROTECTED_ROUTES.find(
        (r) =>
          botIdPathMatches(r.path, h.pathname) &&
          (r.method === "*" || r.method.toUpperCase() === h.method),
      );
      expect(entry, `${h.method} ${h.file} has no protect entry`).toBeDefined();
      expect(entry?.advancedOptions?.checkLevel).toBe("deepAnalysis");
    }
  });

  it("has no protect entry without a matching server gate", () => {
    for (const r of BOTID_PROTECTED_ROUTES) {
      const match = gated.some(
        (h) =>
          botIdPathMatches(r.path, h.pathname) &&
          (r.method === "*" || r.method.toUpperCase() === h.method),
      );
      expect(match, `${r.method} ${r.path} is not gated server-side`).toBe(
        true,
      );
    }
  });
});
