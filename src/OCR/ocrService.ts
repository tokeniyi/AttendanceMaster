import { createWorker, createScheduler, type Worker, type Scheduler } from 'tesseract.js';
import {
  detectTableGrid,
  extractCellImage,
  loadImage,
  renderToCanvas,
  type CellRegion,
} from '@/lib/tableSegmenter';
import { analyseDocument, classifyRow, inferColumnSchema, type SemanticDocument } from '@/lib/semanticAnalyzer';
import { finalizeRowColumns } from '@/lib/dataCorrector';
import { TESSERACT_WORKER_PATH, TESSERACT_CORE_PATH, TESSERACT_LANG_PATH } from '@/lib/config';

export type { SemanticDocument };


export interface OCRLine {
  text: string;
  columns: string[];
  emptyCells?: boolean[];
  confidence: number;
  structuralConfidence: {
    row: number;
    column: number;
    total: number;
  };
  isHeader?: boolean;
  rowIndex?: number;
  region?: 'title' | 'metadata' | 'header' | 'data' | 'footer' | 'empty';
  semanticConfidence?: number;
  explanation?: string;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}


export type ProgressCallback = (message: string, percent: number) => void;

// ─────────────────────────────────────────────────────────────────────────────
// Persistent worker pool
//
// Creating a Tesseract worker downloads/compiles the WASM core and loads the
// pretrained LSTM model — by far the slowest part of a scan. Previously every
// scan created (sequentially!) and destroyed N+1 workers. The pool is now
// created once, in parallel, can be prewarmed while the user is still choosing
// a file, and is released after a period of inactivity to give memory back.
// ─────────────────────────────────────────────────────────────────────────────

/** Tesseract OEM 1 = LSTM neural-net engine only (matches the LSTM-only cores we ship). */
const OEM_LSTM_ONLY = 1;
/** Characters that legitimately appear in register cells; restricting the set cuts hallucinations. */
const CELL_WHITELIST =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,/-()%&' ";
/** Release the pool's WASM memory after this long without a scan. */
const POOL_IDLE_MS = 3 * 60 * 1000;

interface OCRPool {
  scheduler: Scheduler;
  /** Shared worker for single-word fallback (PSM 8) and whole-page reads (PSM 6). */
  general: Worker;
  size: number;
}

let poolPromise: Promise<OCRPool> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let activeRuns = 0;
/** Progress sink for the general worker's logger (set only during a page read). */
let pageProgress: ((progress: number) => void) | null = null;

function poolSize(): number {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
  // Keep one core for the UI thread.
  return Math.max(1, Math.min(4, cores - 1));
}

function makeWorker(logger?: (m: any) => void): Promise<Worker> {
  return createWorker('eng', OEM_LSTM_ONLY, {
    workerPath: TESSERACT_WORKER_PATH,
    corePath: TESSERACT_CORE_PATH,
    langPath: TESSERACT_LANG_PATH,
    workerBlobURL: false,
    ...(logger ? { logger } : {}),
  });
}

async function createPool(): Promise<OCRPool> {
  const size = poolSize();
  const cellWorkers = Array.from({ length: size }, async () => {
    const w = await makeWorker();
    await w.setParameters({
      tessedit_pageseg_mode: '7' as any, // single text line
      tessedit_char_whitelist: CELL_WHITELIST,
      preserve_interword_spaces: '0' as any,
    });
    return w;
  });
  const general = makeWorker((m: any) => {
    if (m?.status === 'recognizing text') pageProgress?.(m.progress ?? 0);
  });

  // All workers start loading at once instead of one after another.
  const settled = await Promise.allSettled([general, ...cellWorkers]);
  const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  const ok = settled.filter((r): r is PromiseFulfilledResult<Worker> => r.status === 'fulfilled').map(r => r.value);
  if (failed) {
    await Promise.allSettled(ok.map(w => w.terminate()));
    throw failed.reason;
  }

  const scheduler = createScheduler();
  ok.slice(1).forEach(w => scheduler.addWorker(w));
  return { scheduler, general: ok[0], size };
}

function getPool(): Promise<OCRPool> {
  if (!poolPromise) {
    poolPromise = createPool();
    // A failed start must not poison every later scan.
    poolPromise.catch(() => { poolPromise = null; });
  }
  return poolPromise;
}

function scheduleIdleShutdown() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (activeRuns === 0) void shutdownOCR();
  }, POOL_IDLE_MS);
  (idleTimer as any)?.unref?.();
}

/**
 * Start loading the OCR engine and pretrained model in the background, e.g.
 * when the upload page mounts. Safe to call repeatedly; never rejects.
 * Resolves `true` once the engine is ready, `false` if it failed to start
 * (the next scan will retry).
 */
export function prewarmOCR(): Promise<boolean> {
  return getPool().then(
    () => { if (activeRuns === 0) scheduleIdleShutdown(); return true; },
    () => false,
  );
}

/** Terminate all workers and free their memory. The next scan recreates the pool. */
export async function shutdownOCR(): Promise<void> {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  const p = poolPromise;
  poolPromise = null;
  if (!p) return;
  try {
    const pool = await p;
    await Promise.allSettled([pool.scheduler.terminate(), pool.general.terminate()]);
  } catch { /* pool never started */ }
}

/** Run `fn` over `items` with at most `limit` in flight (bounds canvas memory). */
async function runLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(lanes);
}

const cleanText = (t: string) => t.trim().replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ');

/**
 * Production-Grade AI-Assisted Structured Data Interpretation Engine.
 *
 * Pipeline:
 *  1. Detect table grid (projection profile analysis)
 *  2. Extract each cell region (adaptive scale + Otsu binarization)
 *  3. Run Tesseract's pretrained LSTM model (PSM 7, single line) on each cell
 *  4. Re-read low-confidence cells in single-word mode (PSM 8)
 *  5. Reconstruct structured row/column grid
 *
 * Falls back to whole-image word-clustering if no grid is detected.
 */
export async function performOCR(
  image: string | File,
  onProgress?: ProgressCallback
): Promise<OCRLine[]> {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  activeRuns++;
  // Engine start-up overlaps with image decode and layout analysis.
  const poolReady = getPool();
  poolReady.catch(() => {});
  let broken = false;
  try {
    onProgress?.('Analysing layout graph…', 5);
    const img = await loadImage(image);
    const grid = await detectTableGrid(img);
    const sourceCanvas = await renderToCanvas(img);

    onProgress?.('Loading OCR model…', 10);
    const pool = await poolReady;

    if (!grid || grid.cells.length === 0) {
      onProgress?.('No clear grid detected — using adaptive word-cluster mode…', 15);
      const rawLines = await runWordCluster(sourceCanvas, pool.general, onProgress);
      const semantic = analyseDocument(rawLines);
      return semantic.rows.filter(r => r.region !== 'empty');
    }

    onProgress?.(`Layout mapped — ${grid.cells.length} cells detected`, 15);
    return await readGrid(grid, sourceCanvas, pool, onProgress);
  } catch (err) {
    // A worker that threw mid-job may be wedged; rebuild the pool next time.
    broken = true;
    throw err;
  } finally {
    activeRuns--;
    if (broken) void shutdownOCR();
    else if (activeRuns === 0) scheduleIdleShutdown();
  }
}

async function readGrid(
  grid: NonNullable<Awaited<ReturnType<typeof detectTableGrid>>>,
  sourceCanvas: HTMLCanvasElement,
  pool: OCRPool,
  onProgress?: ProgressCallback,
): Promise<OCRLine[]> {
  const { scheduler } = pool;
  const numRows = grid.rowBoundaries.length - 1;
  const numCols = grid.colBoundaries.length - 1;
  const cellTexts: string[][] = Array.from({ length: numRows }, () => Array(numCols).fill(''));
  const cellConfs: number[][] = Array.from({ length: numRows }, () => Array(numCols).fill(0));
  const cellEmpty: boolean[][] = Array.from({ length: numRows }, () => Array(numCols).fill(false));
  /** Preprocessed crops of low-confidence cells, kept for the fallback pass instead of re-extracting. */
  const lowConf = new Map<CellRegion, HTMLCanvasElement>();

  const rowsOfCells: CellRegion[][] = Array.from({ length: numRows }, () => []);
  grid.cells.forEach(c => rowsOfCells[c.rowIdx].push(c));

  const totalCells = grid.cells.length;
  let done = 0;
  let started = 0;
  const tick = () => {
    done++;
    if (done % 5 === 0 || done === totalCells) {
      onProgress?.(`Extracting structured data (${done}/${totalCells})…`, 20 + Math.round((done / totalCells) * 70));
    }
  };

  const ocrCell = async (cell: CellRegion, semanticType?: string) => {
    // Yield periodically so synchronous canvas work doesn't starve the progress UI.
    if (started++ % 16 === 15) await new Promise<void>(r => setTimeout(r, 0));
    const { image, analysis } = extractCellImage(sourceCanvas, cell, grid.isInverted);

    // Structural empty-cell suppression: no OCR call, no hallucinated "I"/"oo".
    if (analysis.isEmpty) {
      cellConfs[cell.rowIdx][cell.colIdx] = 100;
      cellEmpty[cell.rowIdx][cell.colIdx] = true;
      tick();
      return;
    }

    try {
      const { data } = await scheduler.addJob('recognize', image);
      let text = cleanText(data.text);
      if (semanticType === 'numeric') text = text.replace(/[^0-9.\-]/g, '');
      cellTexts[cell.rowIdx][cell.colIdx] = text;
      cellConfs[cell.rowIdx][cell.colIdx] = data.confidence;
      if (data.confidence < 70) lowConf.set(cell, image);
    } catch {
      lowConf.set(cell, image);
    }
    tick();
  };

  // Bounded concurrency keeps the queue full without holding every crop in memory.
  const inFlight = pool.size * 3;

  // ── Phase 1: Header discovery & schema locking ──────────────────────────
  onProgress?.('Phase 1: Inferring layout schema…', 20);
  const headerBound = Math.min(4, numRows);
  await runLimited(rowsOfCells.slice(0, headerBound).flat(), inFlight, c => ocrCell(c));

  const tempHeaderRows = [];
  for (let r = 0; r < headerBound; r++) {
    const cols = cellTexts[r].map(t => t.trim());
    if (cols.every(c => c.length === 0)) continue;
    const text = cols.filter(c => c.length > 0).join('  ');
    const rowObj: OCRLine = {
      text, columns: cols, emptyCells: cellEmpty[r], confidence: 100, isHeader: false, rowIndex: r,
      structuralConfidence: { row: 100, column: 100, total: 100 },
      bbox: { x0: grid.colBoundaries[0], y0: grid.rowBoundaries[r], x1: grid.colBoundaries[numCols], y1: grid.rowBoundaries[r + 1] },
    };
    tempHeaderRows.push(classifyRow(rowObj, r, [rowObj]));
  }

  const headersOnly = tempHeaderRows.filter(r => r.region === 'header');
  const dataOnly = tempHeaderRows.filter(r => r.region === 'data');
  const colSchemas = inferColumnSchema(headersOnly, dataOnly, numCols);
  const colTypes = colSchemas.map((c: any) => c.inferredType);

  // ── Phase 2: Parallel data OCR ──────────────────────────────────────────
  onProgress?.('Phase 2: Parallel data extraction…', 30);
  await runLimited(rowsOfCells.slice(headerBound).flat(), inFlight, c => ocrCell(c, colTypes[c.colIdx]));

  // ── Phase 3: Schema validation ──────────────────────────────────────────
  onProgress?.('Phase 3: Structural validation & self-healing…', 92);
  const rowFinal = new Map<number, ReturnType<typeof finalizeRowColumns>>();
  const rowAvg = new Map<number, number>();
  const toHeal: { cell: CellRegion; image: HTMLCanvasElement }[] = [];
  for (let r = 0; r < numRows; r++) {
    const cols = cellTexts[r].map(t => t.trim());
    if (cols.every(c => c.length === 0)) continue;
    const avgConf = cellConfs[r].reduce((s, v) => s + v, 0) / Math.max(1, numCols);
    rowAvg.set(r, avgConf);
    // Corrections apply to EVERY row (backlog #7).
    const final = finalizeRowColumns(cols, numCols, colTypes, avgConf);
    rowFinal.set(r, final);
    if (final.needsFallback) {
      for (const cell of rowsOfCells[r]) {
        const img = lowConf.get(cell);
        if (img && cellConfs[r][cell.colIdx] < 70) toHeal.push({ cell, image: img });
      }
    }
  }

  // ── Phase 4: Fallback — re-read weak cells as a single word (PSM 8) ─────
  const healedRows = new Map<number, string[]>();
  if (toHeal.length > 0) {
    await pool.general.setParameters({
      tessedit_pageseg_mode: '8' as any,
      tessedit_char_whitelist: CELL_WHITELIST,
      preserve_interword_spaces: '0' as any,
    });
    for (const { cell, image } of toHeal) {
      try {
        const { data } = await pool.general.recognize(image);
        const r = cell.rowIdx;
        if (data.confidence > cellConfs[r][cell.colIdx]) {
          const cols = healedRows.get(r) ?? [...rowFinal.get(r)!.columns];
          cols[cell.colIdx] = cleanText(data.text);
          healedRows.set(r, cols);
          cellConfs[r][cell.colIdx] = data.confidence;
        }
      } catch { /* keep the primary read */ }
    }
  }
  lowConf.clear();

  const results: OCRLine[] = [];
  for (const [r, first] of rowFinal) {
    let final = first;
    let explanation = '';
    if (first.needsFallback && first.issues.length > 0) explanation += `Corrected: ${first.issues.join(', ')} | `;
    const healed = healedRows.get(r);
    if (healed) {
      explanation += 'Healed low-confidence cells using fallback model.';
      // Re-validate the healed text so corrections are applied to it too.
      final = finalizeRowColumns(cellTexts[r].map(t => t.trim()), numCols, colTypes, rowAvg.get(r)!, healed);
    }

    const finalCols = final.columns;
    const rowConf = cellConfs[r].reduce((s, v) => s + v, 0) / Math.max(1, numCols);
    results.push({
      text: finalCols.filter(c => c.length > 0).join('  '),
      columns: finalCols,
      emptyCells: cellEmpty[r],
      confidence: rowConf,
      structuralConfidence: { row: 95, column: 90, total: (95 + 90 + rowConf) / 3 },
      isHeader: r < headerBound && headersOnly.some(h => h.rowIndex === r),
      rowIndex: r,
      bbox: { x0: grid.colBoundaries[0], y0: grid.rowBoundaries[r], x1: grid.colBoundaries[numCols], y1: grid.rowBoundaries[r + 1] },
      explanation: explanation.trim() || undefined,
    });
  }

  onProgress?.('Finalizing semantic layout…', 98);
  const semantic = analyseDocument(results);
  return semantic.rows.filter(r => r.region !== 'empty');
}

// ─────────────────────────────────────────────────────────────────────────────
// Word-cluster fallback (for images without clear grid lines)
// ─────────────────────────────────────────────────────────────────────────────

/** Small screenshots are upscaled toward this long edge before a page read. */
const PAGE_MIN_LONG_EDGE = 1600;

async function runWordCluster(
  source: HTMLCanvasElement,
  worker: Worker,
  onProgress?: ProgressCallback
): Promise<OCRLine[]> {
  // Upscale low-resolution input: the LSTM model loses accuracy on tiny glyphs.
  const longEdge = Math.max(source.width, source.height);
  const scale = longEdge > 0 && longEdge < PAGE_MIN_LONG_EDGE ? Math.min(2.5, PAGE_MIN_LONG_EDGE / longEdge) : 1;
  let input: HTMLCanvasElement = source;
  if (scale > 1) {
    input = document.createElement('canvas');
    input.width = Math.round(source.width * scale);
    input.height = Math.round(source.height * scale);
    const ctx = input.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, input.width, input.height);
  }

  // Full-page reads need every character and uniform-block segmentation.
  await worker.setParameters({
    tessedit_pageseg_mode: '6' as any,
    tessedit_char_whitelist: '',
    preserve_interword_spaces: '1' as any,
  });
  pageProgress = p => onProgress?.('Reading text…', 15 + Math.round(p * 65));
  let data;
  try {
    ({ data } = await worker.recognize(input));
  } finally {
    pageProgress = null;
  }
  // Map word boxes back to source-image coordinates.
  if (scale > 1 && data.words) {
    for (const w of data.words) {
      w.bbox = { x0: w.bbox.x0 / scale, y0: w.bbox.y0 / scale, x1: w.bbox.x1 / scale, y1: w.bbox.y1 / scale };
    }
  }

  onProgress?.('Clustering words into rows and columns…', 85);

  const words = data.words;
  if (!words || words.length === 0) return [];

  // Vertical clustering by centre-Y
  const rows: { y: number; ySum: number; words: typeof words; height: number }[] = [];
  const Y_TOL = 14;

  words.forEach(word => {
    // Drop empty/garbage tokens the page read sometimes emits.
    if (!word.text || !word.text.trim()) return;
    const cy = (word.bbox.y0 + word.bbox.y1) / 2;
    const h = word.bbox.y1 - word.bbox.y0;
    const existing = rows.find(r => Math.abs(r.y - cy) < Math.max(Y_TOL, h * 0.45));
    if (existing) {
      existing.words.push(word);
      // Running mean (was an O(k) re-sum per word).
      existing.ySum += cy;
      existing.y = existing.ySum / existing.words.length;
      existing.height = Math.max(existing.height, h);
    } else {
      rows.push({ y: cy, ySum: cy, words: [word], height: h });
    }
  });

  const sortedRows = rows.sort((a, b) => a.y - b.y);
  const results: OCRLine[] = [];

  sortedRows.forEach((row, idx) => {
    const rowWords = row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const columns: string[] = [];
    let currentGroup: string[] = [];

    rowWords.forEach((word, wIdx) => {
      const prev = rowWords[wIdx - 1];
      const gap = prev ? word.bbox.x0 - prev.bbox.x1 : 0;
      if (wIdx > 0 && gap > row.height * 1.5) {
        columns.push(currentGroup.join(' ').trim());
        currentGroup = [word.text];
      } else {
        currentGroup.push(word.text);
      }
    });
    if (currentGroup.length) columns.push(currentGroup.join(' ').trim());

    const clean = columns
      .map(c => c.replace(/^[\[\|]+/, '').replace(/[\]\|]+$/, '').trim())
      .filter(c => c.length > 0);

    if (clean.length === 0) return;

    const avgConf =
      rowWords.reduce((s, w) => s + w.confidence, 0) / rowWords.length;
    const rowYVar =
      rowWords.reduce(
        (s, w) => s + Math.abs((w.bbox.y0 + w.bbox.y1) / 2 - row.y),
        0
      ) / rowWords.length;

    results.push({
      text: clean.join('  '),
      columns: clean,
      confidence: avgConf,
      structuralConfidence: {
        row: Math.max(0, 100 - rowYVar * 5),
        column: clean.length > 1 ? 75 : 50,
        total: (Math.max(0, 100 - rowYVar * 5) + (clean.length > 1 ? 75 : 50) + avgConf) / 3,
      },
      isHeader:
        idx < 2 ||
        clean.some(c =>
          ['name', 'sr', 'designation', 'total', 'present', 'register'].some(
            k => c.toLowerCase().includes(k)
          )
        ),
      rowIndex: idx,
      bbox: {
        x0: Math.min(...rowWords.map(w => w.bbox.x0)),
        y0: Math.min(...rowWords.map(w => w.bbox.y0)),
        x1: Math.max(...rowWords.map(w => w.bbox.x1)),
        y1: Math.max(...rowWords.map(w => w.bbox.y1)),
      },
    });
  });

  onProgress?.('Extraction complete!', 100);
  return results;
}
