import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deleteExport,
  downloadExport,
  listExports,
  uploadExport,
} from "./exports";

/** Build a Supabase-shaped mock that records calls on the storage builder.
 *  Each method (upload/list/download/remove) is its own vi.fn so the
 *  tests can both queue return values and assert on arguments. */
function makeStorageMock(handlers: {
  upload?: ReturnType<typeof vi.fn>;
  list?: ReturnType<typeof vi.fn>;
  download?: ReturnType<typeof vi.fn>;
  remove?: ReturnType<typeof vi.fn>;
}) {
  return {
    storage: {
      from: () => ({
        upload: handlers.upload ?? vi.fn(),
        list: handlers.list ?? vi.fn(),
        download: handlers.download ?? vi.fn(),
        remove: handlers.remove ?? vi.fn(),
      }),
    },
  } as unknown as SupabaseClient;
}

const USER_ID = "11111111-1111-4111-8111-111111111111";

describe("uploadExport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uploads to `<userId>/<exportedAt>.json` and returns the path", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const supabase = makeStorageMock({ upload });
    const path = await uploadExport(supabase, USER_ID, {
      exportedAt: "2026-05-15T10:30:00.000Z",
    });
    expect(path).toBe(`${USER_ID}/2026-05-15T10:30:00.000Z.json`);
    expect(upload).toHaveBeenCalledOnce();
    const [callPath, blob, opts] = upload.mock.calls[0];
    expect(callPath).toBe(path);
    expect(blob).toBeInstanceOf(Blob);
    expect(opts).toMatchObject({
      contentType: "application/json",
      upsert: true,
    });
  });

  it("translates a Supabase error into a thrown Error with the original message", async () => {
    const upload = vi
      .fn()
      .mockResolvedValue({ error: { message: "Bucket not found" } });
    const supabase = makeStorageMock({ upload });
    await expect(
      uploadExport(supabase, USER_ID, { exportedAt: "2026-01-01T00:00:00Z" }),
    ).rejects.toThrow(/Bucket not found/);
  });
});

describe("listExports", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps Supabase entries into CloudExport with size from metadata", async () => {
    const list = vi.fn().mockResolvedValue({
      data: [
        { name: "2026-05-15T10:30:00.000Z.json", metadata: { size: 12_345 } },
        { name: "2026-05-14T08:00:00.000Z.json", metadata: { size: 9_876 } },
      ],
      error: null,
    });
    const supabase = makeStorageMock({ list });
    const out = await listExports(supabase, USER_ID);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      path: `${USER_ID}/2026-05-15T10:30:00.000Z.json`,
      exportedAt: "2026-05-15T10:30:00.000Z",
      sizeBytes: 12_345,
    });
  });

  it("filters out non-json entries (storage sometimes returns folder placeholders)", async () => {
    const list = vi.fn().mockResolvedValue({
      data: [
        { name: ".emptyFolderPlaceholder", metadata: null },
        { name: "2026-05-15T10:30:00.000Z.json", metadata: { size: 1 } },
      ],
      error: null,
    });
    const supabase = makeStorageMock({ list });
    const out = await listExports(supabase, USER_ID);
    expect(out).toHaveLength(1);
    expect(out[0].exportedAt).toBe("2026-05-15T10:30:00.000Z");
  });

  it("returns [] for a user with no uploads", async () => {
    const list = vi.fn().mockResolvedValue({ data: [], error: null });
    const supabase = makeStorageMock({ list });
    expect(await listExports(supabase, USER_ID)).toEqual([]);
  });
});

describe("downloadExport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the blob on success", async () => {
    const blob = new Blob(['{"version":2}'], { type: "application/json" });
    const download = vi.fn().mockResolvedValue({ data: blob, error: null });
    const supabase = makeStorageMock({ download });
    const out = await downloadExport(
      supabase,
      `${USER_ID}/2026-05-15T10:30:00.000Z.json`,
    );
    expect(out).toBe(blob);
  });

  it("throws when Supabase returns an empty response", async () => {
    const download = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = makeStorageMock({ download });
    await expect(downloadExport(supabase, "p")).rejects.toThrow(
      /empty response/,
    );
  });
});

describe("deleteExport", () => {
  it("removes by path and surfaces RLS denials as an Error", async () => {
    const remove = vi
      .fn()
      .mockResolvedValue({ error: { message: "permission denied" } });
    const supabase = makeStorageMock({ remove });
    await expect(deleteExport(supabase, "other-user/x.json")).rejects.toThrow(
      /permission denied/,
    );
    expect(remove).toHaveBeenCalledWith(["other-user/x.json"]);
  });
});
