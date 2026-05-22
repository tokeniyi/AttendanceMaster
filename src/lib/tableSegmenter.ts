/**
 * Table Segmentation Engine
 * Uses horizontal/vertical projection profiles to detect grid structure.
 * This is the standard algorithm for table detection in browser environments.
 */

import { binarize, dilate, analyzeCellDensity, type CellAnalysis } from './computerVision';

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
  source: string | File | Blob
): Promise<TableGrid | null> {
  const img = await loadImage(source);
  const W = img.naturalWidth;
  const H = img.naturalHeight;

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
  const bin = binarize(raw);

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
  const rowBoundaries = findBoundaries(hProj, sH, 0.015, Math.max(3, Math.round(8 / scale))).map(v => Math.round(v * scale));
  const colBoundaries = findBoundaries(vProj, sW, 0.005, Math.max(3, Math.round(10 / scale))).map(v => Math.round(v * scale));

  // Minimum viable table
  if (rowBoundaries.length < 2 || colBoundaries.length < 2) {
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
    isInverted: false, // We handle inversion inside binarize now
  };
}

/**
 * Extract a cell region as a data URL suitable for Tesseract.
 * Applies local preprocessing to maximise OCR accuracy in each cell.
 */
export function extractCellImage(
  sourceCanvas: HTMLCanvasElement,
  cell: CellRegion,
  isInverted: boolean
): { dataUrl: string; analysis: CellAnalysis } {
  const cellCanvas = document.createElement('canvas');
  const SCALE = 3; // Upscale for better OCR on small cells
  cellCanvas.width = cell.w * SCALE;
  cellCanvas.height = cell.h * SCALE;
  const ctx = cellCanvas.getContext('2d', { willReadFrequently: true })!;

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cellCanvas.width, cellCanvas.height);

  // Draw cell content scaled up
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sourceCanvas,
    cell.x, cell.y, cell.w, cell.h,
    0, 0, cellCanvas.width, cellCanvas.height
  );

  // If inverted (white on dark), flip
  if (isInverted) {
    const imgData = ctx.getImageData(0, 0, cellCanvas.width, cellCanvas.height);
    for (let i = 0; i < imgData.data.length; i += 4) {
      imgData.data[i] = 255 - imgData.data[i];
      imgData.data[i + 1] = 255 - imgData.data[i + 1];
      imgData.data[i + 2] = 255 - imgData.data[i + 2];
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // Aggressive contrast boost for the cell
  const imgData = ctx.getImageData(0, 0, cellCanvas.width, cellCanvas.height);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    // Threshold to pure black/white
    const out = v < 140 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = out;
  }
  ctx.putImageData(imgData, 0, 0);

  const bin = binarize(imgData, false);
  const analysis = analyzeCellDensity(bin, cellCanvas.width, cellCanvas.height);

  return {
    dataUrl: cellCanvas.toDataURL('image/png'),
    analysis
  };
}

/**
 * Render the source image into a canvas (needed for extractCellImage).
 */
export async function renderToCanvas(
  source: string | File | Blob
): Promise<HTMLCanvasElement> {
  const img = await loadImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return canvas;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadImage(source: string | File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    if (source instanceof File || source instanceof Blob) {
      img.src = URL.createObjectURL(source);
    } else {
      img.src = source;
    }
  });
}

/**
 * Find boundaries (start/end of content bands) in a projection profile.
 * Returns the pixel positions where bands begin and end.
 */
function findBoundaries(
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
