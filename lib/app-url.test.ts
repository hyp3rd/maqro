import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAppUrl } from "./app-url";

/** Snapshot/restore the three env vars we look at, so each test
 *  runs against a known starting state regardless of what the
 *  Vercel CLI / `.env.local` set in the harness. */
const VARS = [
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
] as const;

describe("getAppUrl", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of VARS) {
      original[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of VARS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it("falls back to localhost when nothing is set", () => {
    expect(getAppUrl()).toBe("http://localhost:3000");
  });

  it("prefers NEXT_PUBLIC_APP_URL over every Vercel signal", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://maqro.app";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "maqro.vercel.app";
    process.env.VERCEL_URL = "maqro-abc123.vercel.app";
    expect(getAppUrl()).toBe("https://maqro.app");
  });

  it("uses VERCEL_PROJECT_PRODUCTION_URL when no explicit override", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "maqro.vercel.app";
    process.env.VERCEL_URL = "maqro-abc123.vercel.app";
    expect(getAppUrl()).toBe("https://maqro.vercel.app");
  });

  it("falls back to VERCEL_URL only when both above are missing", () => {
    process.env.VERCEL_URL = "maqro-abc123.vercel.app";
    expect(getAppUrl()).toBe("https://maqro-abc123.vercel.app");
  });

  it("strips a trailing slash from the explicit override", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://maqro.app/";
    expect(getAppUrl()).toBe("https://maqro.app");
  });

  it("strips a trailing slash from VERCEL_PROJECT_PRODUCTION_URL", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "maqro.vercel.app/";
    expect(getAppUrl()).toBe("https://maqro.vercel.app");
  });
});
