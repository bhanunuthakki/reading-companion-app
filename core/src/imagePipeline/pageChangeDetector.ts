/**
 * Local, model-free page-change detection. Runs on the client (where the camera
 * is) so we only spend an OCR call when a genuinely new, sharp page settles —
 * the cheap gate in front of the expensive vision call, and the key to not
 * draining the glasses battery with needless captures.
 *
 * Two signals:
 *   - dHash (perceptual difference hash) + Hamming distance → "is this a
 *     different page than the last stable one?"
 *   - variance-of-Laplacian → "is this frame sharp, or motion-blurred?"
 *
 * All functions are pure over a GrayscaleImage; the detector takes an explicit
 * `nowMs` so its stability/debounce logic is deterministic and testable.
 */

export interface GrayscaleImage {
  width: number;
  height: number;
  /** Row-major grayscale, length width*height, each value 0..255. */
  data: Uint8Array;
}

export type PageChangeReason =
  | "first-page"
  | "page-change"
  | "same-page"
  | "candidate"
  | "stabilizing"
  | "blurry";

export interface PageObservation {
  changed: boolean;
  reason: PageChangeReason;
  sharpness: number;
  hash: bigint;
}

export interface PageChangeConfig {
  /** Hamming distance above which two frames are considered different pages. */
  hashThreshold: number;
  /** Hamming distance within which a frame still counts as the same candidate. */
  candidateTolerance: number;
  /** variance-of-Laplacian floor; below this a frame is motion-blurred and ignored. */
  sharpnessThreshold: number;
  /** A candidate page must persist at least this long before it fires. */
  stabilityMs: number;
  /** Minimum gap between two fired page changes. */
  debounceMs: number;
}

export const DEFAULT_PAGE_CHANGE_CONFIG: PageChangeConfig = {
  hashThreshold: 10,
  candidateTolerance: 4,
  sharpnessThreshold: 100,
  stabilityMs: 500,
  debounceMs: 1500,
};

/** Area-average downsample to an exact target size. */
export function downsample(img: GrayscaleImage, targetW: number, targetH: number): GrayscaleImage {
  const out = new Uint8Array(targetW * targetH);
  for (let ty = 0; ty < targetH; ty++) {
    const y0 = Math.floor((ty * img.height) / targetH);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * img.height) / targetH));
    for (let tx = 0; tx < targetW; tx++) {
      const x0 = Math.floor((tx * img.width) / targetW);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * img.width) / targetW));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sum += img.data[y * img.width + x] as number; // index provably in bounds
          count++;
        }
      }
      out[ty * targetW + tx] = count > 0 ? Math.round(sum / count) : 0;
    }
  }
  return { width: targetW, height: targetH, data: out };
}

/** 64-bit difference hash (downsamples to 9×8, compares horizontal neighbours). */
export function dHash(img: GrayscaleImage): bigint {
  const size = 8;
  const small = downsample(img, size + 1, size);
  let hash = 0n;
  let bit = 0n;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const left = small.data[y * (size + 1) + x] as number;
      const right = small.data[y * (size + 1) + x + 1] as number;
      if (left > right) hash |= 1n << bit;
      bit++;
    }
  }
  return hash;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** Sharpness metric: variance of the Laplacian over interior pixels. */
export function varianceOfLaplacian(img: GrayscaleImage): number {
  const { width: w, height: h, data } = img;
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = data[y * w + x] as number;
      const up = data[(y - 1) * w + x] as number;
      const down = data[(y + 1) * w + x] as number;
      const left = data[y * w + x - 1] as number;
      const right = data[y * w + x + 1] as number;
      const lap = up + down + left + right - 4 * c;
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export class PageChangeDetector {
  private lastStableHash: bigint | null = null;
  private candidateHash: bigint | null = null;
  private candidateSince = 0;
  private lastFireAt = Number.NEGATIVE_INFINITY;
  private readonly config: PageChangeConfig;

  constructor(config: Partial<PageChangeConfig> = {}) {
    this.config = { ...DEFAULT_PAGE_CHANGE_CONFIG, ...config };
  }

  observe(img: GrayscaleImage, nowMs: number): PageObservation {
    const sharpness = varianceOfLaplacian(img);
    const hash = dHash(img);

    if (sharpness < this.config.sharpnessThreshold) {
      return { changed: false, reason: "blurry", sharpness, hash };
    }

    if (this.lastStableHash === null) {
      this.lastStableHash = hash;
      this.lastFireAt = nowMs;
      this.candidateHash = null;
      return { changed: true, reason: "first-page", sharpness, hash };
    }

    if (hammingDistance(hash, this.lastStableHash) <= this.config.hashThreshold) {
      this.candidateHash = null;
      return { changed: false, reason: "same-page", sharpness, hash };
    }

    const isNewCandidate =
      this.candidateHash === null ||
      hammingDistance(hash, this.candidateHash) > this.config.candidateTolerance;
    if (isNewCandidate) {
      this.candidateHash = hash;
      this.candidateSince = nowMs;
      return { changed: false, reason: "candidate", sharpness, hash };
    }

    const stableEnough = nowMs - this.candidateSince >= this.config.stabilityMs;
    const pastDebounce = nowMs - this.lastFireAt >= this.config.debounceMs;
    if (stableEnough && pastDebounce) {
      this.lastStableHash = hash;
      this.lastFireAt = nowMs;
      this.candidateHash = null;
      return { changed: true, reason: "page-change", sharpness, hash };
    }
    return { changed: false, reason: "stabilizing", sharpness, hash };
  }

  reset(): void {
    this.lastStableHash = null;
    this.candidateHash = null;
    this.candidateSince = 0;
    this.lastFireAt = Number.NEGATIVE_INFINITY;
  }
}
