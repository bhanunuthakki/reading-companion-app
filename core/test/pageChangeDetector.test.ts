import { describe, it, expect } from "vitest";
import {
  type GrayscaleImage,
  dHash,
  hammingDistance,
  varianceOfLaplacian,
  PageChangeDetector,
} from "../src/imagePipeline/pageChangeDetector";

function make(width: number, height: number, fn: (x: number, y: number) => number): GrayscaleImage {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = Math.max(0, Math.min(255, Math.round(fn(x, y))));
    }
  }
  return { width, height, data };
}

// Coarse horizontal gradient (distinct dHash) + fine checker dither (high sharpness).
const dither = (x: number, y: number): number => ((x + y) % 2 === 0 ? 30 : -30);
const ramp = (reverse: boolean): GrayscaleImage =>
  make(32, 32, (x, y) => ((reverse ? 31 - x : x) / 31) * 200 + 25 + dither(x, y));

const pageA = ramp(false);
const pageB = ramp(true);
const blurry = make(32, 32, () => 128); // flat → Laplacian variance 0

describe("dHash + hammingDistance", () => {
  it("is identical to itself", () => {
    expect(hammingDistance(dHash(pageA), dHash(pageA))).toBe(0);
  });

  it("separates two clearly different pages well past the default threshold", () => {
    expect(hammingDistance(dHash(pageA), dHash(pageB))).toBeGreaterThan(10);
  });
});

describe("varianceOfLaplacian", () => {
  it("is high for a sharp, detailed frame", () => {
    expect(varianceOfLaplacian(pageA)).toBeGreaterThan(100);
  });

  it("is zero for a flat (blurred) frame", () => {
    expect(varianceOfLaplacian(blurry)).toBe(0);
  });
});

describe("PageChangeDetector", () => {
  it("fires on the first sharp page", () => {
    const det = new PageChangeDetector();
    const obs = det.observe(pageA, 0);
    expect(obs).toMatchObject({ changed: true, reason: "first-page" });
  });

  it("reports the same page when nothing changes", () => {
    const det = new PageChangeDetector();
    det.observe(pageA, 0);
    expect(det.observe(pageA, 100)).toMatchObject({ changed: false, reason: "same-page" });
  });

  it("rejects blurry frames without firing", () => {
    const det = new PageChangeDetector();
    expect(det.observe(blurry, 0)).toMatchObject({ changed: false, reason: "blurry" });
  });

  it("requires a new page to stay stable before firing", () => {
    const det = new PageChangeDetector({ debounceMs: 0, stabilityMs: 500 });
    det.observe(pageA, 0);
    expect(det.observe(pageB, 100)).toMatchObject({ reason: "candidate" });
    expect(det.observe(pageB, 300)).toMatchObject({ changed: false, reason: "stabilizing" });
    expect(det.observe(pageB, 700)).toMatchObject({ changed: true, reason: "page-change" });
  });

  it("debounces rapid page changes", () => {
    const det = new PageChangeDetector({ stabilityMs: 0, debounceMs: 1500 });
    det.observe(pageA, 0); // first-page, fires at t=0
    det.observe(pageB, 100); // new candidate
    expect(det.observe(pageB, 150)).toMatchObject({ changed: false, reason: "stabilizing" });
    expect(det.observe(pageB, 1600)).toMatchObject({ changed: true, reason: "page-change" });
  });
});
