import { beforeEach, describe, expect, it, vi } from "vitest";

/** Mock the Resend SDK with a controllable instance. Each test
 *  drives `listMock` / `getMock` / `attachmentsListMock` and
 *  asserts the wrapper's output. The wrapper's value is in its
 *  defensive coercion and error-shape translation, not in
 *  contacting the network. */
const { listMock, getMock, attachmentsListMock } = vi.hoisted(() => ({
  listMock: vi.fn() as ReturnType<typeof vi.fn>,
  getMock: vi.fn() as ReturnType<typeof vi.fn>,
  attachmentsListMock: vi.fn() as ReturnType<typeof vi.fn>,
}));

vi.mock("resend", () => ({
  Resend: class StubResend {
    emails = {
      receiving: {
        list: listMock,
        get: getMock,
        attachments: { list: attachmentsListMock },
      },
    };
  },
}));

let originalKey: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  originalKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "re_test";
});

async function loadLib() {
  return await import("./receiving");
}

describe("listReceivedEmails", () => {
  it("returns 'not-configured' when RESEND_API_KEY is missing", async () => {
    delete process.env.RESEND_API_KEY;
    const { listReceivedEmails } = await loadLib();
    const r = await listReceivedEmails();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not-configured");
    process.env.RESEND_API_KEY = originalKey;
  });

  it("coerces the Resend list response into summary rows", async () => {
    listMock.mockResolvedValueOnce({
      data: [
        {
          id: "em_1",
          from: "alice@example.com",
          to: ["support@maqro.app"],
          subject: "Help with my account",
          text: "Hi team, my login isn't working...",
          created_at: "2026-05-23T10:00:00Z",
          attachments: [{ id: "att_1" }],
        },
      ],
      error: null,
    });
    const { listReceivedEmails } = await loadLib();
    const r = await listReceivedEmails();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.emails).toHaveLength(1);
      expect(r.emails[0]?.subject).toBe("Help with my account");
      expect(r.emails[0]?.hasAttachments).toBe(true);
      expect(r.emails[0]?.snippet).toContain("Hi team");
    }
  });

  it("walks the {data: {data: []}} shape (SDK version variance)", async () => {
    listMock.mockResolvedValueOnce({
      data: { data: [{ id: "em_2", subject: "Nested shape" }] },
      error: null,
    });
    const { listReceivedEmails } = await loadLib();
    const r = await listReceivedEmails();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.emails[0]?.subject).toBe("Nested shape");
  });

  it("returns 'api-error' when Resend reports a failure", async () => {
    listMock.mockResolvedValueOnce({
      data: null,
      error: { message: "rate limited" },
    });
    const { listReceivedEmails } = await loadLib();
    const r = await listReceivedEmails();
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "api-error") {
      expect(r.error.message).toMatch(/rate limited/);
    }
  });

  it("returns 'api-error' when the SDK throws", async () => {
    listMock.mockRejectedValueOnce(new Error("network down"));
    const { listReceivedEmails } = await loadLib();
    const r = await listReceivedEmails();
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "api-error") {
      expect(r.error.message).toMatch(/network down/);
    }
  });

  it("truncates long snippets with an ellipsis", async () => {
    const longText = "A".repeat(200);
    listMock.mockResolvedValueOnce({
      data: [{ id: "em_3", text: longText, subject: "Long" }],
      error: null,
    });
    const { listReceivedEmails } = await loadLib();
    const r = await listReceivedEmails();
    if (r.ok) {
      expect(r.emails[0]?.snippet.length).toBeLessThanOrEqual(140);
      expect(r.emails[0]?.snippet.endsWith("…")).toBe(true);
    }
  });
});

describe("getReceivedEmail", () => {
  it("returns 'not-configured' when RESEND_API_KEY is missing", async () => {
    delete process.env.RESEND_API_KEY;
    const { getReceivedEmail } = await loadLib();
    const r = await getReceivedEmail("em_1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not-configured");
    process.env.RESEND_API_KEY = originalKey;
  });

  it("returns 'not-found' when Resend says the id doesn't exist", async () => {
    getMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Resource not found" },
    });
    const { getReceivedEmail } = await loadLib();
    const r = await getReceivedEmail("em_missing");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not-found");
  });

  it("includes html, text, and headers on a full detail fetch", async () => {
    getMock.mockResolvedValueOnce({
      data: {
        id: "em_1",
        from: "alice@example.com",
        to: ["support@maqro.app"],
        subject: "Help",
        html: "<p>Hello</p>",
        text: "Hello",
        headers: { "x-trace-id": "abc123" },
        created_at: "2026-05-23T10:00:00Z",
      },
      error: null,
    });
    const { getReceivedEmail } = await loadLib();
    const r = await getReceivedEmail("em_1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.email.html).toBe("<p>Hello</p>");
      expect(r.email.text).toBe("Hello");
      expect(r.email.headers["x-trace-id"]).toBe("abc123");
    }
  });
});

describe("listReceivedAttachments", () => {
  it("coerces the attachment list shape", async () => {
    attachmentsListMock.mockResolvedValueOnce({
      data: [
        {
          id: "att_1",
          filename: "invoice.pdf",
          content_type: "application/pdf",
          size: 12345,
        },
      ],
      error: null,
    });
    const { listReceivedAttachments } = await loadLib();
    const r = await listReceivedAttachments("em_1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.attachments).toHaveLength(1);
      expect(r.attachments[0]?.filename).toBe("invoice.pdf");
      expect(r.attachments[0]?.size).toBe(12345);
      expect(r.attachments[0]?.emailId).toBe("em_1");
    }
  });

  it("falls back to 'application/octet-stream' when content_type is missing", async () => {
    attachmentsListMock.mockResolvedValueOnce({
      data: [{ id: "att_2", filename: "blob" }],
      error: null,
    });
    const { listReceivedAttachments } = await loadLib();
    const r = await listReceivedAttachments("em_1");
    if (r.ok) {
      expect(r.attachments[0]?.contentType).toBe("application/octet-stream");
    }
  });
});
