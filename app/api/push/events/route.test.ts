import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tests for POST /api/push/events — the service-worker → server
 *  callback for push-notification engagement. Surface is small
 *  but has a tricky shape: unconfigured-Supabase returns 202
 *  (silent-accept, NOT 503) because the SW shouldn't care, and
 *  the body parser is the one place that traps a thrown
 *  `req.json()`. Each branch is asserted because a regression in
 *  any of them would either leak SW errors back to the browser
 *  (bad UX, notification stays stuck) or 500 a legitimate
 *  unauthenticated SW call (which we want as a silent 401). */

const { mockGetSupabaseServer, mockInsert } = vi.hoisted(() => ({
  mockGetSupabaseServer: vi.fn(),
  // Cast widens the inferred return so the error-branch test
  // can override with `{ error: { message } }`.
  mockInsert: vi.fn(
    async () => ({ error: null }) as { error: { message: string } | null },
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: mockGetSupabaseServer,
}));

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/push/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rawReq(body: string): Request {
  return new Request("http://localhost/api/push/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSupabaseServer.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
    },
    from: () => ({ insert: mockInsert }),
  });
  mockInsert.mockResolvedValue({ error: null });
});

describe("POST /api/push/events", () => {
  it("returns 202 { recorded: false } when Supabase isn't configured", async () => {
    // Preview env. The SW shouldn't see a 5xx here — it'd retry
    // forever and pollute the console. Silent-accept is by design.
    mockGetSupabaseServer.mockResolvedValueOnce(null);
    const { POST } = await loadRoute();
    const res = await POST(jsonReq({ event: "click", tag: "daily-reminder" }));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean; recorded: boolean };
    expect(body).toEqual({ ok: true, recorded: false });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no signed-in user", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
      from: () => ({ insert: mockInsert }),
    });
    const { POST } = await loadRoute();
    const res = await POST(jsonReq({ event: "click" }));
    expect(res.status).toBe(401);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("returns 400 when the body isn't valid JSON", async () => {
    const { POST } = await loadRoute();
    const res = await POST(rawReq("not-json{"));
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("returns 400 when event isn't 'click' or 'close'", async () => {
    const { POST } = await loadRoute();
    const res = await POST(jsonReq({ event: "open" }));
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("returns 500 and propagates the message when the insert errors", async () => {
    mockInsert.mockResolvedValueOnce({
      error: { message: "RLS denied for push_event_log" },
    });
    const { POST } = await loadRoute();
    const res = await POST(jsonReq({ event: "click", tag: "daily-reminder" }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("RLS denied for push_event_log");
  });

  it("returns 202 { recorded: true } on a valid click event", async () => {
    const { POST } = await loadRoute();
    const res = await POST(jsonReq({ event: "click", tag: "daily-reminder" }));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean; recorded: boolean };
    expect(body).toEqual({ ok: true, recorded: true });
    expect(mockInsert).toHaveBeenCalledWith({
      user_id: "user-1",
      event: "click",
      tag: "daily-reminder",
    });
  });

  it("coerces whitespace-only tag to null on the insert payload", async () => {
    // Empty/whitespace tags shouldn't pollute the engagement
    // table with empty strings — null is the canonical "no tag"
    // sentinel.
    const { POST } = await loadRoute();
    const res = await POST(jsonReq({ event: "close", tag: "   " }));
    expect(res.status).toBe(202);
    expect(mockInsert).toHaveBeenCalledWith({
      user_id: "user-1",
      event: "close",
      tag: null,
    });
  });
});
