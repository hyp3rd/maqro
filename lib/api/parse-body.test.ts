import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseBody } from "./parse-body";

function jsonRequest(body: string | unknown): Request {
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
  return new Request("http://localhost/test", init);
}

describe("parseBody", () => {
  const Schema = z.object({
    name: z.string().min(1),
    count: z.number().int().nonnegative(),
  });

  it("returns ok + parsed data on a matching body", async () => {
    const req = jsonRequest({ name: "Hello", count: 3 });
    const result = await parseBody(req, Schema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ name: "Hello", count: 3 });
    }
  });

  it("returns 400 with an envelope when the body isn't JSON", async () => {
    const req = jsonRequest("not-json{");
    const result = await parseBody(req, Schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = (await result.response.json()) as { error: string };
      expect(body.error).toMatch(/invalid json/i);
    }
  });

  it("returns 400 with field path on schema mismatch", async () => {
    const req = jsonRequest({ name: "", count: -1 });
    const result = await parseBody(req, Schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = (await result.response.json()) as {
        error: string;
        fields: Record<string, string[]>;
      };
      // First failing issue surfaces in the summary; the full map
      // lives in `fields`.
      expect(body.error).toMatch(/^name:/);
      expect(body.fields.name?.length).toBeGreaterThan(0);
      expect(body.fields.count?.length).toBeGreaterThan(0);
    }
  });

  it("returns 400 without a path prefix on top-level errors", async () => {
    // Top-level: expected an object, got a string.
    const req = jsonRequest("just a string, JSON-valid");
    const result = await parseBody(req, Schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = (await result.response.json()) as { error: string };
      // No "name:" or "count:" prefix — the failure is on the root.
      expect(body.error).not.toMatch(/^name:/);
      expect(body.error).not.toMatch(/^count:/);
    }
  });

  it("accepts optional fields when the schema marks them so", async () => {
    const Optional = z.object({
      name: z.string(),
      nickname: z.string().optional(),
    });
    const result = await parseBody(jsonRequest({ name: "x" }), Optional);
    expect(result.ok).toBe(true);
  });

  it("rejects extra fields only when the schema is strict", async () => {
    // Default Zod object: extra fields are stripped, not rejected.
    const result = await parseBody(
      jsonRequest({ name: "x", count: 0, extra: 1 }),
      Schema,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The unknown `extra` is dropped, not preserved on `.data`.
      expect((result.data as Record<string, unknown>).extra).toBeUndefined();
    }
  });
});
