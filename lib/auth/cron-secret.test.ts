import { beforeEach, describe, expect, it } from "vitest";
import { assertCronSecret } from "./cron-secret";

function req(authHeader: string | null): Request {
  const headers = new Headers();
  if (authHeader !== null) headers.set("authorization", authHeader);
  return new Request("http://localhost/cron", { method: "GET", headers });
}

describe("assertCronSecret", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-key-123";
  });

  it("returns null (pass) when the header matches", () => {
    expect(assertCronSecret(req("Bearer test-cron-key-123"))).toBeNull();
  });

  it("returns 401 when the header is missing", async () => {
    const res = assertCronSecret(req(null));
    expect(res).not.toBeNull();
    expect(res?.status).toBe(401);
  });

  it("returns 401 when the header is wrong", async () => {
    const res = assertCronSecret(req("Bearer wrong-secret"));
    expect(res).not.toBeNull();
    expect(res?.status).toBe(401);
  });

  it("returns 401 when the header is the right prefix but wrong tail (no length-leak via timingSafeEqual)", async () => {
    // The hashing step in the helper normalizes both sides to a
    // 32-byte sha256 digest, so timingSafeEqual never sees uneven
    // lengths and never throws — the only signal is "match or not".
    const res = assertCronSecret(req("Bearer test-cron-key-12"));
    expect(res).not.toBeNull();
    expect(res?.status).toBe(401);
  });

  it("returns 503 when CRON_SECRET is unset on the deployment", async () => {
    delete process.env.CRON_SECRET;
    const res = assertCronSecret(req("Bearer anything"));
    expect(res?.status).toBe(503);
  });
});
