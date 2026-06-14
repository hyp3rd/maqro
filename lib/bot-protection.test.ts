import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Only the deep-tier helper survives now (see `lib/bot-protection.ts`
 *  header for why the basic-tier `requireHuman` was retired).
 *
 *  Coverage:
 *    - **non-prod short-circuit** — happy path returns ok:true
 *      without ever touching the BotID SDK, suppressing the dev-
 *      time warning.
 *    - **production behavior** — verdict + 403 routing, plus the
 *      fail-closed path on `checkBotId` throw. */

const { mockCheckBotId, mockReportServerError } = vi.hoisted(() => ({
  mockCheckBotId: vi.fn(),
  mockReportServerError: vi.fn(async () => {}),
}));

vi.mock("botid/server", () => ({ checkBotId: mockCheckBotId }));
vi.mock("@/lib/error-reporter", () => ({
  reportServerError: mockReportServerError,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requireHumanDeep — non-prod short-circuit", () => {
  it("returns ok:true without calling checkBotId in dev / test", async () => {
    mockCheckBotId.mockResolvedValue({ isBot: true });
    const { requireHumanDeep } = await import("./bot-protection");
    expect((await requireHumanDeep()).ok).toBe(true);
    expect(mockCheckBotId).not.toHaveBeenCalled();
  });
});

describe("requireHumanDeep — enforce-mode in production", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
  });

  it("passes checkLevel: 'deepAnalysis' to checkBotId", async () => {
    mockCheckBotId.mockResolvedValue({ isBot: false });
    const { requireHumanDeep } = await import("./bot-protection");
    await requireHumanDeep();
    expect(mockCheckBotId).toHaveBeenCalledWith({
      advancedOptions: { checkLevel: "deepAnalysis" },
    });
  });

  it("returns a 403 NextResponse on a bot verdict", async () => {
    mockCheckBotId.mockResolvedValue({ isBot: true });
    const { requireHumanDeep } = await import("./bot-protection");
    const result = await requireHumanDeep();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      const body = (await result.response.json()) as { error: string };
      // Body intentionally generic — see helper header comment.
      expect(body.error).toBe("Access denied.");
    }
    // The block is logged so a false positive is visible, not a mystery 403.
    expect(mockReportServerError).toHaveBeenCalled();
  });

  it("fails CLOSED when checkBotId throws — 403 + log", async () => {
    // A config error on a deep-tier route locks the request out
    // because deep-tier protects destructive / financial actions.
    mockCheckBotId.mockRejectedValue(new Error("BotID API down"));
    const { requireHumanDeep } = await import("./bot-protection");
    const result = await requireHumanDeep();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
    expect(mockReportServerError).toHaveBeenCalled();
  });

  it("returns ok:true for verified humans", async () => {
    mockCheckBotId.mockResolvedValue({ isBot: false });
    const { requireHumanDeep } = await import("./bot-protection");
    expect((await requireHumanDeep()).ok).toBe(true);
  });
});
