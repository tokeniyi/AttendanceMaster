/**
 * Table Segmentation Engine
 * Uses horizontal/vertical projection profiles to detect grid structure.
 * This is the standard algorithm for table detection in browser environments.
 */

import { binarize, detectInverted, dilate, analyzeCellDensity, otsuThreshold, cellScaleFactor, luminanceHistogram, type CellAnalysis } from './computerVision';

/** Anything that can be drawn and measured: a decoded image or an already-rendered canvas. */
export type DrawableSource = HTMLImageElement | HTMLCanvasElement;

export interface CellRegion {
  rowIdx: number;
  colIdx: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TableGrid {
  cells: CellRegion[];
  rowBoundaries: number[];
  colBoundaries: number[];
  imageWidth: number;
  imageHeight: number;
  isInverted: boolean;
  /** The preprocessed grayscale canvas data URL for debugging */
  debugCanvas?: string;
}

export async function detectTableGrid(
  source: string | File | Blob | DrawableSource
): Promise<TableGrid | null> {
  const img = isDrawable(source) ? source : await loadImage(source);
  const W = img instanceof HTMLCanvasElement ? img.width : img.naturalWidth;
  const H = img instanceof HTMLCanvasElement ? img.height : img.naturalHeight;

  if (W === 0 || H === 0) return null;

  // ─── Step 1: Render to SCALED canvas to eliminate lag ──────────────────────
  const MAX_DIM = 1000;
  let scale = 1;
  let sW = W;
  let sH = H;
  if (W > MAX_DIM || H > MAX_DIM) {
    if (W > H) { scale = W / MAX_DIM; sW = MAX_DIM; sH = Math.round(H / scale); }
    else { scale = H / MAX_DIM; sH = MAX_DIM; sW = Math.round(W / scale); }
  }

  const canvas = document.createElement('canvas');
  canvas.width = sW;
  canvas.height = sH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, sW, sH);

  const raw = ctx.getImageData(0, 0, sW, sH);
  
  // ─── Step 2: Binarize & Detect Polarity ──────────────────────────────────
  const isInverted = detectInverted(raw);
  // Global Otsu cut: a fixed threshold turned grey/dim photographed paper into
  // solid "ink" and the layout disappeared. Clamped so extreme pages stay sane.
  const otsu = otsuThreshold(luminanceHistogram(raw, 2), isInverted ? 100 : 160);
  const bin = binarize(raw, isInverted, Math.min(200, Math.max(70, otsu)));

  // ─── Step 2b: Ruling lines ───────────────────────────────────────────────
  // Ruled registers have no whitespace between rows/columns — the lines ARE
  // the separators. Detect them, then erase them so the gap-based projection
  // below sees clean whitespace where the rules were.
  const ruling = detectRulingLines(bin, sW, sH);
  eraseRulingLines(bin, sW, sH, ruling);

  // ─── Step 3: Morphological Preprocessing for Layout Inference ────────────
  // We use smaller kernels since the image is downscaled
  const colMap = dilate(bin, sW, sH, 2, 20);
  const rowMap = dilate(bin, sW, sH, 20, 2);

  // ─── Step 4: Horizontal Projection → Row boundaries ────────────────────
  const hProj = new Float32Array(sH);
  for (let y = 0; y < sH; y++) {
    let dark = 0;
    for (let x = 0; x < sW; x++) {
      if (rowMap[y * sW + x] === 1) dark++;
    }
    hProj[y] = dark / sW;
  }

  // ─── Step 5: Vertical Projection → Global Column Anchoring ───────────────
  const vProj = new Float32Array(sW);
  for (let x = 0; x < sW; x++) {
    let dark = 0;
    for (let y = 0; y < sH; y++) {
      if (colMap[y * sW + x] === 1) dark++;
    }
    vProj[x] = dark / sH;
  }

  // ─── Step 6: Find row separators & scale back up ──────────────────────────
  const gapRows = findBoundaries(hProj, sH, 0.015, Math.max(3, Math.round(8 / scale)));
  const gapCols = findBoundaries(vProj, sW, 0.005, Math.max(3, Math.round(10 / scale)));
  // Prefer explicit rules when the table has them (≥2 lines on an axis).
  const rowBoundaries = (ruling.rows.length >= 2 ? withEdges(ruling.rows, sH, Math.round(sH * 0.04)) : gapRows).map(v => Math.round(v * scale));
  const colBoundaries = (ruling.cols.length >= 2 ? withEdges(ruling.cols, sW, Math.round(sW * 0.04)) : gapCols).map(v => Math.round(v * scale));

  // Minimum viable table: a "grid" of one or two bands is just the whole page,
  // which a single-line cell read can't handle — let the word-cluster mode read it.
  if (rowBoundaries.length < 4 || colBoundaries.length < 2) {
    return null;
  }

  // ─── Step 6: Build cell grid ─────────────────────────────────────────────
  const cells: CellRegion[] = [];
  const PADDING = 3; // px padding inside each cell to avoid border noise

  for (let r = 0; r < rowBoundaries.length - 1; r++) {
    for (let c = 0; c < colBoundaries.length - 1; c++) {
      const x = colBoundaries[c] + PADDING;
      const y = rowBoundaries[r] + PADDING;
      let w = colBoundaries[c + 1] - colBoundaries[c] - PADDING * 2;
      let h = rowBoundaries[r + 1] - rowBoundaries[r] - PADDING * 2;

      // Ensure minimum dimensions to prevent Tesseract crashes
      if (w < 20) w = 20;
      if (h < 20) h = 20;

      cells.push({ rowIdx: r, colIdx: c, x, y, w, h });
    }
  }

  return {
    cells,
    rowBoundaries,
    colBoundaries,
    imageWidth: W,
    imageHeight: H,
    isInverted,
  };
}

/** White margin added around every crop: Tesseract segments far better when glyphs don't touch the edge. */
const CELL_MARGIN = 10;

/**
 * Extract a cell region as a canvas suitable for Tesseract.
 *
 * Preprocessing per cell:
 *  - adaptive upscale (see cellScaleFactor) with smoothing, so small cells are
 *    enlarged without jagged edges and large cells aren't needlessly tripled;
 *  - polarity fix for inverted (light-on-dark) scans;
 *  - Otsu binarization on the cell's own histogram (adapts to local lighting);
 *  - a white margin so text never touches the crop border.
 *
 * Returns the canvas itself rather than a data URL: tesseract.js encodes a
 * canvas asynchronously (toBlob), whereas toDataURL blocked the main thread for
 * every cell.
 */
export function extractCellImage(
  sourceCanvas: HTMLCanvasElement,
  cell: CellRegion,
  isInverted: boolean
): { image: HTMLCanvasElement; analysis: CellAnalysis } {
  const scale = cellScaleFactor(cell.h);
  const innerW = Math.max(1, Math.round(cell.w * scale));
  const innerH = Math.max(1, Math.round(cell.h * scale));
  const cellCanvas = document.createElement('canvas');
  cellCanvas.width = innerW + CELL_MARGIN * 2;
  cellCanvas.height = innerH + CELL_MARGIN * 2;
  const ctx = cellCanvas.getContext('2d', { willReadFrequently: true })!;

  // Inverted scans: paint a dark margin so it becomes white after inversion.
  ctx.fillStyle = isInverted ? '#000000' : '#ffffff';
  ctx.fillRect(0, 0, cellCanvas.width, cellCanvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, cell.x, cell.y, cell.w, cell.h, CELL_MARGIN, CELL_MARGIN, innerW, innerH);

  const imgData = ctx.getImageData(0, 0, cellCanvas.width, cellCanvas.height);
  const d = imgData.data;
  const n = cellCanvas.width * cellCanvas.height;
  const gray = new Uint8Array(n);
  const hist = new Uint32Array(256);
  const W = cellCanvas.width;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    let v = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) | 0;
    if (isInverted) v = 255 - v;
    gray[i] = v;
    // Histogram the real crop only — the synthetic white margin would skew Otsu
    // on grey paper and turn the whole background into "ink".
    const x = i % W;
    const y = (i - x) / W;
    if (x >= CELL_MARGIN && x < CELL_MARGIN + innerW && y >= CELL_MARGIN && y < CELL_MARGIN + innerH) hist[v]++;
  }

  // Clamp Otsu so a cell that is all ink or all paper can't pick an absurd cut.
  const t = Math.min(190, Math.max(90, otsuThreshold(hist)));
  const bin = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const ink = gray[i] < t;
    bin[i] = ink ? 1 : 0;
    const out = ink ? 0 : 255;
    d[p] = d[p + 1] = d[p + 2] = out;
    d[p + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);

  // Analyse the crop without the synthetic margin so the border-line heuristics
  // in analyzeCellDensity (components touching the edge) still see the real edges.
  const inner = new Uint8Array(innerW * innerH);
  for (let y = 0; y < innerH; y++) {
    const row = (y + CELL_MARGIN) * W + CELL_MARGIN;
    inner.set(bin.subarray(row, row + innerW), y * innerW);
  }
  const analysis = analyzeCellDensity(inner, innerW, innerH);
  return { image: cellCanvas, analysis };
}

/**
 * Render the source image into a canvas (needed for extractCellImage).
 */
export async function renderToCanvas(
  source: string | File | Blob | HTMLImageElement
): Promise<HTMLCanvasElement> {
  const img = source instanceof HTMLImageElement ? source : await loadImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return canvas;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isDrawable(source: unknown): source is DrawableSource {
  return (
    (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) ||
    (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement)
  );
}

/** Decode an image once; callers pass the element on to avoid decoding the same file twice. */
export function loadImage(source: string | File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl =
      source instanceof File || source instanceof Blob ? URL.createObjectURL(source) : null;
    // Once decoded, the bitmap lives in the element; the blob URL is no longer needed.
    const release = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    img.onload = () => {
      release();
      resolve(img);
    };
    img.onerror = (e) => {
      release();
      reject(e);
    };
    img.src = objectUrl ?? (source as string);
  });
}

export interface RulingLines {
  /** Centre y of each horizontal rule (canvas pixels). */
  rows: number[];
  /** Centre x of each vertical rule. */
  cols: number[];
  /** Pixel bands [start, end] covered by each rule, for erasing. */
  rowBands: [number, number][];
  colBands: [number, number][];
}

/**
 * Finds table rules: rows/columns of the binary image containing a single
 * unbroken ink run of at least `minFrac` of the image extent. Text never
 * produces runs that long, so this isolates printed/drawn grid lines.
 * Adjacent line pixels (thick or anti-aliased rules) merge into one line.
 */
export function detectRulingLines(bin: Uint8Array, w: number, h: number, minFrac = 0.3): RulingLines {
  const longestRun = (len: number, at: (i: number) => number) => {
    let best = 0;
    let run = 0;
    // Tolerate 1-2px breaks from scan noise / JPEG artefacts.
    let gap = 0;
    for (let i = 0; i < len; i++) {
      if (at(i) === 1) { run += gap + 1; gap = 0; if (run > best) best = run; }
      else if (run > 0 && gap < 2) gap++;
      else { run = 0; gap = 0; }
    }
    return best;
  };
  const isRow = (y: number) => longestRun(w, x => bin[y * w + x]) >= w * minFrac;
  const isCol = (x: number) => longestRun(h, y => bin[y * w + x]) >= h * minFrac;
  const bands = (len: number, test: (i: number) => boolean) => {
    const out: [number, number][] = [];
    let start = -1;
    for (let i = 0; i <= len; i++) {
      const on = i < len && test(i);
      if (on && start < 0) start = i;
      else if (!on && start >= 0) {
        // A band thicker than ~3% of the extent is a filled region, not a rule.
        if (i - start <= Math.max(4, len * 0.03)) out.push([start, i - 1]);
        start = -1;
      }
    }
    return out;
  };
  // Lines closer together than this are a double rule — keep one separator.
  const dedupe = (bs: [number, number][], minSpacing: number) => {
    const res: [number, number][] = [];
    for (const b of bs) {
      const last = res[res.length - 1];
      if (last && b[0] - last[1] < minSpacing) last[1] = b[1];
      else res.push([b[0], b[1]]);
    }
    return res;
  };
  const rowBands = dedupe(bands(h, isRow), Math.max(6, h * 0.01));
  const colBands = dedupe(bands(w, isCol), Math.max(6, w * 0.01));
  const centre = ([a, b]: [number, number]) => Math.round((a + b) / 2);
  return { rows: rowBands.map(centre), cols: colBands.map(centre), rowBands, colBands };
}

/** Clears detected rules (plus a 1px halo) from the binary image in place. */
export function eraseRulingLines(bin: Uint8Array, w: number, h: number, lines: RulingLines): void {
  for (const [a, b] of lines.rowBands) {
    for (let y = Math.max(0, a - 1); y <= Math.min(h - 1, b + 1); y++) bin.fill(0, y * w, (y + 1) * w);
  }
  for (const [a, b] of lines.colBands) {
    for (let y = 0; y < h; y++) {
      for (let x = Math.max(0, a - 1); x <= Math.min(w - 1, b + 1); x++) bin[y * w + x] = 0;
    }
  }
}

/**
 * Rules as boundaries, plus the image edges when there is real margin content
 * (e.g. a title above the first rule) so it isn't silently dropped.
 */
function withEdges(lines: number[], size: number, minMargin: number): number[] {
  const out = [...lines];
  if (out[0] > minMargin) out.unshift(0);
  if (size - 1 - out[out.length - 1] > minMargin) out.push(size - 1);
  return out;
}

/**
 * Find boundaries (start/end of content bands) in a projection profile.
 * Returns the pixel positions where bands begin and end.
 */
export function findBoundaries(
  proj: Float32Array,
  size: number,
  threshold: number,
  minGap: number
): number[] {
  const boundaries: number[] = [0];
  let inGap = false;
  let gapStart = 0;

  for (let i = 0; i < size; i++) {
    if (proj[i] <= threshold) {
      if (!inGap) {
        inGap = true;
        gapStart = i;
      }
    } else {
      if (inGap) {
        const gapSize = i - gapStart;
        if (gapSize >= minGap) {
          // Middle of gap = separator line
          const sep = Math.round((gapStart + i) / 2);
          boundaries.push(sep);
        }
        inGap = false;
      }
    }
  }

  boundaries.push(size - 1);
  return boundaries;
}
