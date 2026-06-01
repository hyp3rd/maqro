/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Avoid loading the real zxing chunk in unit tests. The runtime can
 *  resolve the import (the test mock just shorts it out) and we never
 *  exercise the fallback engine path here — that's a UI concern. */
vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatOneDReader: class {
    decodeFromVideoElement = vi.fn();
    decodeFromCanvas = vi.fn();
  },
}));
vi.mock("@zxing/library", () => ({
  BarcodeFormat: { EAN_13: 0, UPC_A: 1, EAN_8: 2 },
  DecodeHintType: { POSSIBLE_FORMATS: 0, TRY_HARDER: 1 },
  Result: class {},
}));

const realDetector = (globalThis as unknown as { BarcodeDetector?: unknown })
  .BarcodeDetector;

/** Reset the per-tab cache the real module keeps for getSupportedFormats(). */
async function freshModule() {
  vi.resetModules();
  return import("./barcode");
}

afterEach(() => {
  (globalThis as unknown as { BarcodeDetector?: unknown }).BarcodeDetector =
    realDetector;
  vi.resetModules();
});

beforeEach(() => {
  vi.resetModules();
});

describe("detectBarcodeAvailability — engine selection", () => {
  it("picks the NATIVE engine when BarcodeDetector exposes product-barcode formats", async () => {
    class FakeDetector {
      detect = vi.fn();
      static async getSupportedFormats() {
        return ["ean_13", "upc_a", "qr_code"];
      }
    }
    (
      globalThis as unknown as { BarcodeDetector: typeof FakeDetector }
    ).BarcodeDetector = FakeDetector;
    const { detectBarcodeAvailability } = await freshModule();
    const result = await detectBarcodeAvailability();
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.engine.source).toBe("native");
    }
  });

  it("falls back to the ZXING engine when BarcodeDetector only does QR (iOS Safari)", async () => {
    class FakeDetector {
      detect = vi.fn();
      static async getSupportedFormats() {
        return ["qr_code"];
      }
    }
    (
      globalThis as unknown as { BarcodeDetector: typeof FakeDetector }
    ).BarcodeDetector = FakeDetector;
    const { detectBarcodeAvailability } = await freshModule();
    const result = await detectBarcodeAvailability();
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.engine.source).toBe("zxing");
    }
  });

  it("falls back to ZXING when BarcodeDetector isn't present (Firefox)", async () => {
    delete (globalThis as unknown as { BarcodeDetector?: unknown })
      .BarcodeDetector;
    const { detectBarcodeAvailability } = await freshModule();
    const result = await detectBarcodeAvailability();
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.engine.source).toBe("zxing");
    }
  });
});

describe("native engine — startLiveDetect", () => {
  it("fires onDetect on the first successful read and stops", async () => {
    const code = "5901234123457";
    let detectCallCount = 0;
    class FakeDetector {
      // Resolve once with the code, then keep returning empty arrays
      // forever. Test asserts only one onDetect even though more frames
      // would be available.
      detect = vi.fn(async () => {
        detectCallCount++;
        if (detectCallCount === 1) {
          return [{ rawValue: code, format: "ean_13" }];
        }
        return [];
      });
      static async getSupportedFormats() {
        return ["ean_13"];
      }
    }
    (
      globalThis as unknown as { BarcodeDetector: typeof FakeDetector }
    ).BarcodeDetector = FakeDetector;

    // Stub rAF to a microtask queue we can drive manually.
    const rafCallbacks: Array<FrameRequestCallback> = [];
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");
    rafSpy.mockImplementation((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});

    const { detectBarcodeAvailability } = await freshModule();
    const avail = await detectBarcodeAvailability();
    if (avail.kind !== "ready") throw new Error("expected ready");

    const onDetect = vi.fn();
    const video = document.createElement("video");
    const stop = avail.engine.startLiveDetect(video, onDetect);

    // Drain a handful of rAF callbacks — the first detect call should
    // fire onDetect and stop the loop.
    for (let i = 0; i < 4 && onDetect.mock.calls.length === 0; i++) {
      const next = rafCallbacks.shift();
      if (!next) break;
      next(0);
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(onDetect).toHaveBeenCalledWith(code);
    expect(onDetect).toHaveBeenCalledTimes(1);
    stop();
    rafSpy.mockRestore();
  });
});

describe("native engine — decodeFrame", () => {
  it("returns the rawValue of the first detected code", async () => {
    class FakeDetector {
      detect = vi.fn().mockResolvedValue([
        { rawValue: "12345678", format: "ean_8" },
        { rawValue: "99999999", format: "ean_8" },
      ]);
      static async getSupportedFormats() {
        return ["ean_13", "ean_8"];
      }
    }
    (
      globalThis as unknown as { BarcodeDetector: typeof FakeDetector }
    ).BarcodeDetector = FakeDetector;

    const { detectBarcodeAvailability } = await freshModule();
    const avail = await detectBarcodeAvailability();
    if (avail.kind !== "ready") throw new Error("expected ready");

    const bitmap = {} as ImageBitmap;
    const code = await avail.engine.decodeFrame(bitmap);
    expect(code).toBe("12345678");
  });

  it("returns null when the detector finds nothing", async () => {
    class FakeDetector {
      detect = vi.fn().mockResolvedValue([]);
      static async getSupportedFormats() {
        return ["ean_13"];
      }
    }
    (
      globalThis as unknown as { BarcodeDetector: typeof FakeDetector }
    ).BarcodeDetector = FakeDetector;

    const { detectBarcodeAvailability } = await freshModule();
    const avail = await detectBarcodeAvailability();
    if (avail.kind !== "ready") throw new Error("expected ready");

    const bitmap = {} as ImageBitmap;
    const code = await avail.engine.decodeFrame(bitmap);
    expect(code).toBeNull();
  });

  it("swallows detector errors and returns null", async () => {
    class FakeDetector {
      detect = vi.fn().mockRejectedValue(new Error("boom"));
      static async getSupportedFormats() {
        return ["ean_13"];
      }
    }
    (
      globalThis as unknown as { BarcodeDetector: typeof FakeDetector }
    ).BarcodeDetector = FakeDetector;

    const { detectBarcodeAvailability } = await freshModule();
    const avail = await detectBarcodeAvailability();
    if (avail.kind !== "ready") throw new Error("expected ready");

    const bitmap = {} as ImageBitmap;
    const code = await avail.engine.decodeFrame(bitmap);
    expect(code).toBeNull();
  });
});

describe("normalizeManualBarcode", () => {
  it("strips non-digits and returns the cleaned code", async () => {
    const { normalizeManualBarcode } = await freshModule();
    expect(normalizeManualBarcode(" 5901-234 123 457 ")).toBe("5901234123457");
  });

  it("returns null for codes shorter than 8 digits", async () => {
    const { normalizeManualBarcode } = await freshModule();
    expect(normalizeManualBarcode("12345")).toBeNull();
  });

  it("returns null for codes longer than 14 digits", async () => {
    const { normalizeManualBarcode } = await freshModule();
    expect(normalizeManualBarcode("1".repeat(15))).toBeNull();
  });

  it("accepts EAN-8, UPC-A (12), EAN-13, and ITF-14 lengths", async () => {
    const { normalizeManualBarcode } = await freshModule();
    expect(normalizeManualBarcode("12345678")).toBe("12345678");
    expect(normalizeManualBarcode("123456789012")).toBe("123456789012");
    expect(normalizeManualBarcode("1234567890123")).toBe("1234567890123");
    expect(normalizeManualBarcode("12345678901234")).toBe("12345678901234");
  });
});
