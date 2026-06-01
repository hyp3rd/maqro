import { describe, expect, it } from "vitest";
import { laplacianVariance } from "./sharpness";

/** Build a synthetic grayscale image of given dimensions. The
 *  `fill` callback returns 0–255 per pixel. */
function image(
  width: number,
  height: number,
  fill: (x: number, y: number) => number,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = fill(x, y);
    }
  }
  return data;
}

describe("laplacianVariance", () => {
  it("returns 0 for a uniform image (no edges, no variance)", () => {
    const flat = image(20, 20, () => 128);
    expect(laplacianVariance(flat, 20, 20)).toBe(0);
  });

  it("scores a sharp checkerboard higher than a uniform image", () => {
    const flat = image(20, 20, () => 128);
    const checker = image(20, 20, (x, y) => ((x + y) % 2 === 0 ? 0 : 255));
    const flatScore = laplacianVariance(flat, 20, 20);
    const checkerScore = laplacianVariance(checker, 20, 20);
    expect(checkerScore).toBeGreaterThan(flatScore);
  });

  it("scores a sharp edge higher than a blurry gradient", () => {
    // Hard step edge at x=10: black → white in one pixel.
    const sharp = image(20, 20, (x) => (x < 10 ? 0 : 255));
    // Smooth gradient: black at x=0, white at x=19. Slope 13/pixel.
    const blurry = image(20, 20, (x) => Math.round((x / 19) * 255));
    const sharpScore = laplacianVariance(sharp, 20, 20);
    const blurryScore = laplacianVariance(blurry, 20, 20);
    expect(sharpScore).toBeGreaterThan(blurryScore);
  });

  it("returns 0 on degenerate dimensions (width or height < 3)", () => {
    const tinyW = image(2, 10, () => 0);
    const tinyH = image(10, 2, () => 0);
    expect(laplacianVariance(tinyW, 2, 10)).toBe(0);
    expect(laplacianVariance(tinyH, 10, 2)).toBe(0);
  });

  it("higher-contrast edge → higher score (monotonic in step size)", () => {
    // Two step edges at x=10 with different jump magnitudes.
    const small = image(20, 20, (x) => (x < 10 ? 100 : 130));
    const big = image(20, 20, (x) => (x < 10 ? 0 : 255));
    expect(laplacianVariance(big, 20, 20)).toBeGreaterThan(
      laplacianVariance(small, 20, 20),
    );
  });
});
