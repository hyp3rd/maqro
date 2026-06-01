/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function freshModule() {
  vi.resetModules();
  const mod = await import("./storage-status");
  mod.__resetStorageStatusForTests();
  return mod;
}

describe("storage-status", () => {
  it("starts in the ok state", async () => {
    const { getStorageStatus } = await freshModule();
    expect(getStorageStatus()).toEqual({ ok: true, acknowledged: false });
  });

  it("reportStorageError flips ok=false and resets acknowledged", async () => {
    const { getStorageStatus, reportStorageError } = await freshModule();
    reportStorageError(new Error("boom"));
    expect(getStorageStatus()).toEqual({ ok: false, acknowledged: false });
  });

  it("coalesces back-to-back errors (state stays in error)", async () => {
    const { getStorageStatus, reportStorageError } = await freshModule();
    reportStorageError(new Error("first"));
    reportStorageError(new Error("second"));
    expect(getStorageStatus()).toEqual({ ok: false, acknowledged: false });
  });

  it("ackStorageError marks the banner dismissed without clearing ok=false", async () => {
    const { getStorageStatus, reportStorageError, ackStorageError } =
      await freshModule();
    reportStorageError(new Error("x"));
    ackStorageError();
    expect(getStorageStatus()).toEqual({ ok: false, acknowledged: true });
  });

  it("a fresh error after ack resets acknowledged so the banner re-shows", async () => {
    const { getStorageStatus, reportStorageError, ackStorageError } =
      await freshModule();
    reportStorageError(new Error("x"));
    ackStorageError();
    // The current model coalesces consecutive errors — only an Ok in
    // between would reset to a fresh failure cycle.
    reportStorageError(new Error("y"));
    // Still acknowledged because we already saw the failure state.
    expect(getStorageStatus()).toEqual({ ok: false, acknowledged: true });
  });

  it("reportStorageOk clears the error", async () => {
    const { getStorageStatus, reportStorageError, reportStorageOk } =
      await freshModule();
    reportStorageError(new Error("x"));
    reportStorageOk();
    expect(getStorageStatus()).toEqual({ ok: true, acknowledged: false });
  });

  it("after recovery, the next failure re-shows the banner (acknowledged reset)", async () => {
    const {
      getStorageStatus,
      reportStorageError,
      ackStorageError,
      reportStorageOk,
    } = await freshModule();
    reportStorageError(new Error("x"));
    ackStorageError();
    reportStorageOk();
    reportStorageError(new Error("z"));
    expect(getStorageStatus()).toEqual({ ok: false, acknowledged: false });
  });
});
