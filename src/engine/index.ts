type Pixel = [number, number, number, number];

export interface ImagifyResult {
  canvas: HTMLCanvasElement;
  assignment: number[];
  sourcePixels: Pixel[];
  size: number;
  elapsedMs: number;
  method: 'exact' | 'heuristic';
}

const EXACT_THRESHOLD = 2304; // 48×48 — largest n for exact Hungarian
const POSITION_WEIGHT = 300; // penalises long-range pixel movement

export async function imagify(
  source: Blob,
  target: Blob,
  weightsCanvas: HTMLCanvasElement | null,
  size = 32,
  onProgress?: (phase: string, progress: number) => void,
): Promise<ImagifyResult> {
  const start = performance.now();

  onProgress?.('Downsampling', 0.05);
  const [dsSource, dsTarget] = await Promise.all([
    downsampleImage(source, size),
    downsampleImage(target, size),
  ]);

  onProgress?.('Extracting pixels', 0.08);
  const [sourceMatrix, targetMatrix] = await Promise.all([
    imageToMatrix(dsSource),
    imageToMatrix(dsTarget),
  ]);

  const n = size * size;
  const sourcePixels: Pixel[] = new Array(n);
  const targetPixels: Pixel[] = new Array(n);
  const targetWeights = new Float64Array(n);

  const weightsData = extractWeights(weightsCanvas, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      sourcePixels[idx] = sourceMatrix[y][x] as Pixel;
      targetPixels[idx] = targetMatrix[y][x] as Pixel;
      targetWeights[idx] = weightsData[idx];
    }
  }

  let assignment: number[];
  let method: 'exact' | 'heuristic';

  if (n <= EXACT_THRESHOLD) {
    method = 'exact';
    onProgress?.('Building cost matrix', 0.1);
    const costMatrix = buildCostMatrix(
      sourcePixels,
      targetPixels,
      targetWeights,
      size,
    );

    onProgress?.('Running Hungarian algorithm', 0.15);
    assignment = await hungarian(n, costMatrix, (row, total) => {
      onProgress?.('Running Hungarian algorithm', 0.15 + 0.8 * (row / total));
    });
  } else {
    method = 'heuristic';
    assignment = await heuristicMatch(
      sourcePixels,
      targetPixels,
      targetWeights,
      size,
      onProgress,
    );
  }

  onProgress?.('Rendering result', 0.95);
  const canvas = renderAssignment(sourcePixels, assignment, size);

  onProgress?.('Done', 1);
  return {
    canvas,
    assignment,
    sourcePixels,
    size,
    elapsedMs: performance.now() - start,
    method,
  };
}

/**
 * Downsamples the paint canvas to the working size and extracts weight values.
 * Uses the alpha channel of each pixel as the weight (0-255 -> 0.0-1.0).
 * If no canvas is provided, returns uniform zero weights (baseline 0.1 still applies in the cost formula).
 */
function extractWeights(
  canvas: HTMLCanvasElement | null,
  size: number,
): Float64Array {
  const n = size * size;
  const weights = new Float64Array(n);
  if (!canvas) return weights;

  const tmp = document.createElement('canvas');
  tmp.width = size;
  tmp.height = size;
  const ctx = tmp.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  for (let i = 0; i < n; i++) {
    weights[i] = data[i * 4 + 3] / 255;
  }
  return weights;
}

// ---------------------------------------------------------------------------
// Heuristic: Morton-sort initial match + 2-opt swap refinement
// ---------------------------------------------------------------------------

/**
 * Maps an RGB pixel to a Morton (Z-order) code by interleaving the bits of
 * each channel. This creates a 1D ordering that preserves 3D color locality,
 * so sorting by Morton code groups perceptually similar colors together.
 */
function mortonCode(r: number, g: number, b: number): number {
  let code = 0;
  for (let bit = 7; bit >= 0; bit--) {
    code = (code << 1) | ((r >> bit) & 1);
    code = (code << 1) | ((g >> bit) & 1);
    code = (code << 1) | ((b >> bit) & 1);
  }
  return code;
}

function assignmentCost(
  si: number,
  tj: number,
  source: Pixel[],
  target: Pixel[],
  weights: Float64Array,
  size: number,
): number {
  const [sr, sg, sb, sa] = source[si];
  const [tr, tg, tb, ta] = target[tj];
  const colorDist = Math.sqrt(
    (sr - tr) ** 2 + (sg - tg) ** 2 + (sb - tb) ** 2 + (sa - ta) ** 2,
  );
  const dx = (si % size) - (tj % size);
  const dy = ((si / size) | 0) - ((tj / size) | 0);
  const posDist = Math.sqrt(dx * dx + dy * dy) / size;
  return colorDist * (0.1 + weights[tj]) + posDist * POSITION_WEIGHT;
}

const REFINEMENT_PASSES = 200;

async function heuristicMatch(
  source: Pixel[],
  target: Pixel[],
  weights: Float64Array,
  size: number,
  onProgress?: (phase: string, progress: number) => void,
): Promise<number[]> {
  const n = source.length;

  // Phase 1 — sort both pixel arrays by Morton code and match in order
  onProgress?.('Sorting by color (Morton curve)', 0.1);

  const srcOrder = new Array<number>(n);
  const tgtOrder = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    srcOrder[i] = i;
    tgtOrder[i] = i;
  }

  srcOrder.sort(
    (a, b) =>
      mortonCode(source[a][0], source[a][1], source[a][2]) -
      mortonCode(source[b][0], source[b][1], source[b][2]),
  );
  tgtOrder.sort(
    (a, b) =>
      mortonCode(target[a][0], target[a][1], target[a][2]) -
      mortonCode(target[b][0], target[b][1], target[b][2]),
  );

  const assignment = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    assignment[srcOrder[k]] = tgtOrder[k];
  }

  // Phase 2 — random 2-opt swap refinement
  const totalIter = REFINEMENT_PASSES * n;
  const yieldInterval = Math.max(1, Math.floor(totalIter / 500));

  for (let iter = 0; iter < totalIter; iter++) {
    const i = (Math.random() * n) | 0;
    const j = (Math.random() * n) | 0;
    if (i === j) continue;

    const ai = assignment[i];
    const aj = assignment[j];

    const curCost =
      assignmentCost(i, ai, source, target, weights, size) +
      assignmentCost(j, aj, source, target, weights, size);
    const swpCost =
      assignmentCost(i, aj, source, target, weights, size) +
      assignmentCost(j, ai, source, target, weights, size);

    if (swpCost < curCost) {
      assignment[i] = aj;
      assignment[j] = ai;
    }

    if (iter % yieldInterval === 0) {
      onProgress?.(
        'Refining assignment (2-opt swaps)',
        0.15 + 0.8 * (iter / totalIter),
      );
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  return Array.from(assignment);
}

// ---------------------------------------------------------------------------
// Exact: Kuhn-Munkres (Hungarian) algorithm — O(n³)
// ---------------------------------------------------------------------------

function buildCostMatrix(
  source: Pixel[],
  target: Pixel[],
  weights: Float64Array,
  size: number,
): Float32Array {
  const n = source.length;
  const cost = new Float32Array(n * n);

  for (let i = 0; i < n; i++) {
    const [sr, sg, sb, sa] = source[i];
    const srcX = i % size;
    const srcY = (i / size) | 0;
    const rowOffset = i * n;
    for (let j = 0; j < n; j++) {
      const [tr, tg, tb, ta] = target[j];
      const colorDist = Math.sqrt(
        (sr - tr) ** 2 + (sg - tg) ** 2 + (sb - tb) ** 2 + (sa - ta) ** 2,
      );
      const dx = srcX - (j % size);
      const dy = srcY - ((j / size) | 0);
      const posDist = Math.sqrt(dx * dx + dy * dy) / size;
      cost[rowOffset + j] =
        colorDist * (0.1 + weights[j]) + posDist * POSITION_WEIGHT;
    }
  }

  return cost;
}

/**
 * Kuhn-Munkres (Hungarian) algorithm for minimum-cost perfect matching.
 * O(n³) time, O(n) auxiliary space (cost matrix passed in).
 *
 * Returns assignment[i] = j, meaning source pixel i maps to target position j.
 */
async function hungarian(
  n: number,
  cost: Float32Array,
  onProgress?: (row: number, total: number) => void,
): Promise<number[]> {
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1);
  const way = new Int32Array(n + 1);

  for (let i = 1; i <= n; i++) {
    if (i % 50 === 0) {
      onProgress?.(i, n);
      await new Promise<void>((r) => setTimeout(r, 0));
    }

    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);

    do {
      used[j0] = 1;
      const i0 = p[j0];
      const rowOffset = (i0 - 1) * n;
      let delta = Infinity;
      let j1 = -1;

      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const reduced = cost[rowOffset + j - 1] - u[i0] - v[j];
        if (reduced < minv[j]) {
          minv[j] = reduced;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }

      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }

      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const result = new Array<number>(n);
  for (let j = 1; j <= n; j++) {
    result[p[j] - 1] = j - 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Renders a single animation frame. Each pixel is linearly interpolated
 * from its source grid position to its assigned target position.
 *
 * @param t  Progress in [0, 1]. 0 = source layout, 1 = target layout.
 */
export function renderFrame(
  { sourcePixels, assignment, size }: ImagifyResult,
  t: number,
  canvas: HTMLCanvasElement,
): void {
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(size, size);
  const eased = easeInOutCubic(Math.max(0, Math.min(1, t)));

  for (let i = 0; i < sourcePixels.length; i++) {
    const srcX = i % size;
    const srcY = (i / size) | 0;

    const tgt = assignment[i];
    const tgtX = tgt % size;
    const tgtY = (tgt / size) | 0;

    const x = Math.round(srcX + (tgtX - srcX) * eased);
    const y = Math.round(srcY + (tgtY - srcY) * eased);

    const cx = Math.max(0, Math.min(size - 1, x));
    const cy = Math.max(0, Math.min(size - 1, y));

    const dst = (cy * size + cx) * 4;
    const [r, g, b, a] = sourcePixels[i];
    imageData.data[dst] = r;
    imageData.data[dst + 1] = g;
    imageData.data[dst + 2] = b;
    imageData.data[dst + 3] = a;
  }

  ctx.putImageData(imageData, 0, 0);
}

// ---------------------------------------------------------------------------
// Rendering & image helpers
// ---------------------------------------------------------------------------

function renderAssignment(
  sourcePixels: Pixel[],
  assignment: number[],
  size: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(size, size);

  for (let i = 0; i < sourcePixels.length; i++) {
    const dst = assignment[i] * 4;
    const [r, g, b, a] = sourcePixels[i];
    imageData.data[dst] = r;
    imageData.data[dst + 1] = g;
    imageData.data[dst + 2] = b;
    imageData.data[dst + 3] = a;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

async function imageToMatrix(image: Blob): Promise<number[][][]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(image);
    img.src = url;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0);
      const { data, width, height } = ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      );

      const matrix: number[][][] = Array.from({ length: height }, () =>
        Array.from({ length: width }, () => [0, 0, 0, 0]),
      );

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const pi = (y * width + x) * 4;
          matrix[y][x] = [data[pi], data[pi + 1], data[pi + 2], data[pi + 3]];
        }
      }

      URL.revokeObjectURL(url);
      resolve(matrix);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
  });
}

async function downsampleImage(image: Blob, size: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(image);
    img.src = url;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, size, size);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (!blob) {
          reject(new Error('Failed to convert canvas to blob'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
  });
}
