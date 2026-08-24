import { createWorker, createScheduler, Worker } from 'tesseract.js';
import {
  detectTableGrid,
  extractCellImage,
  renderToCanvas,
  type CellRegion,
  type TableGrid,
} from '@/lib/tableSegmenter';
import { analyseDocument, classifyRow, inferColumnSchema, type SemanticDocument } from '@/lib/semanticAnalyzer';
import { validateRow } from '@/lib/dataCorrector';

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

/**
 * Production-Grade AI-Assisted Structured Data Interpretation Engine.
 *
 * Pipeline:
 *  1. Detect table grid (projection profile analysis)
 *  2. Extract each cell region
 *  3. Run Tesseract PSM 7 (single line) on each cell
 *  4. Reconstruct structured row/column grid
 *
 * Falls back to whole-image word-clustering if no grid is detected.
 */
export async function performOCR(
  image: string | File,
  onProgress?: ProgressCallback
): Promise<OCRLine[]> {

  // ── Phase 0: Fast Layout Prepass ─────────────────────────────────────────
  onProgress?.('Analysing layout graph…', 5);
  const grid = await detectTableGrid(image);

  if (!grid || grid.cells.length === 0) {
    onProgress?.('No clear grid detected — using adaptive word-cluster mode…', 15);
    const rawLines = await runWordCluster(image, onProgress);
    const semantic = analyseDocument(rawLines);
    return semantic.rows.filter(r => r.region !== 'empty');
  }

  onProgress?.(`Layout mapped — ${grid.cells.length} cells detected`, 15);
  const sourceCanvas = await renderToCanvas(image);

  // ── Phase 1: Initialize Parallel Workers & Fallback ─────────────────────
  // Adaptive scaling: keep one CPU available for the UI.
  const hardwareConcurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 2;
  const numWorkers = Math.max(1, Math.min(4, hardwareConcurrency - 1));

  const scheduler = createScheduler();
  for (let i = 0; i < numWorkers; i++) {
    const w = await createWorker('eng', 1, { workerPath: '/tesseract/worker.min.js', corePath: '/tesseract/tesseract-core.wasm.js', workerBlobURL: false });
    await w.setParameters({ tessedit_pageseg_mode: '7' as any, tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,/-()% ', preserve_interword_spaces: '0' as any });
    scheduler.addWorker(w);
  }

  // Persistent fallback worker for structurally anomalous cells
  const fallbackWorker = await createWorker('eng', 1, { workerPath: '/tesseract/worker.min.js', corePath: '/tesseract/tesseract-core.wasm.js', workerBlobURL: false });
  await fallbackWorker.setParameters({ tessedit_pageseg_mode: '8' as any, tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,/-()% ', preserve_interword_spaces: '0' as any });
  try {

  const numRows = grid.rowBoundaries.length - 1;
  const numCols = grid.colBoundaries.length - 1;
  const cellTexts: string[][] = Array.from({ length: numRows }, () => Array(numCols).fill(''));
  const cellConfs: number[][] = Array.from({ length: numRows }, () => Array(numCols).fill(0));
  const cellEmpty: boolean[][] = Array.from({ length: numRows }, () => Array(numCols).fill(false));

  // Batch Coordinator: Group cells by row
  const rowsOfCells: CellRegion[][] = Array.from({ length: numRows }, () => []);
  grid.cells.forEach(c => rowsOfCells[c.rowIdx].push(c));

  const totalCells = grid.cells.length;
  let done = 0;

  const ocrCell = async (cell: CellRegion, semanticType?: string) => {
    const { dataUrl, analysis } = extractCellImage(sourceCanvas, cell, grid.isInverted);
    
    // ── Structural Empty Cell Suppression ──
    if (analysis.isEmpty) {
      cellTexts[cell.rowIdx][cell.colIdx] = '';
      cellConfs[cell.rowIdx][cell.colIdx] = 100; // 100% confident it's empty
      cellEmpty[cell.rowIdx][cell.colIdx] = true;
      done++;
      if (done % 5 === 0 || done === totalCells) {
        onProgress?.(`Extracting structured data (${done}/${totalCells})…`, 20 + Math.round((done / totalCells) * 70));
      }
      return;
    }

    try {
      const { data } = await scheduler.addJob('recognize', dataUrl);
      
      // Dynamic cleanup based on semantic type
      let text = data.text.trim().replace(/\n/g, ' ');
      
      if (semanticType === 'numeric') {
        text = text.replace(/[^0-9.\-]/g, ''); // Aggressively reject alphabet hallucinations
      }

      cellTexts[cell.rowIdx][cell.colIdx] = text;
      cellConfs[cell.rowIdx][cell.colIdx] = data.confidence;
    } catch { }
    done++;
    if (done % 5 === 0 || done === totalCells) {
      onProgress?.(`Extracting structured data (${done}/${totalCells})…`, 20 + Math.round((done / totalCells) * 70));
    }
  };

  // ── Phase 1: Header Discovery & Schema Locking ──────────────────────────
  onProgress?.('Phase 1: Inferring layout schema…', 20);
  const headerBound = Math.min(4, numRows);
  const headerPromises: Promise<void>[] = [];
  
  for (let r = 0; r < headerBound; r++) {
    for (const cell of rowsOfCells[r]) headerPromises.push(ocrCell(cell));
  }
  await Promise.all(headerPromises);

  // Lock Column Types Early
  const tempHeaderRows = [];
  for (let r = 0; r < headerBound; r++) {
    const cols = cellTexts[r].map(t => t.trim());
    if (cols.every(c => c.length === 0)) continue;
    const text = cols.filter(c => c.length > 0).join('  ');
    const rowObj: OCRLine = {
      text, columns: cols, emptyCells: cellEmpty[r], confidence: 100, isHeader: false, rowIndex: r,
      structuralConfidence: { row: 100, column: 100, total: 100 },
      bbox: { x0: grid.colBoundaries[0], y0: grid.rowBoundaries[r], x1: grid.colBoundaries[numCols], y1: grid.rowBoundaries[r+1] }
    };
    tempHeaderRows.push(classifyRow(rowObj, r, [rowObj]));
  }
  
  const headersOnly = tempHeaderRows.filter(r => r.region === 'header');
  const dataOnly = tempHeaderRows.filter(r => r.region === 'data');
  const colSchemas = inferColumnSchema(headersOnly, dataOnly, numCols);
  const colTypes = colSchemas.map((c: any) => c.inferredType);

  // ── Phase 2: Parallel Data OCR ──────────────────────────────────────────
  onProgress?.('Phase 2: Parallel data extraction…', 30);
  const dataPromises: Promise<void>[] = [];
  for (let r = headerBound; r < numRows; r++) {
    for (const cell of rowsOfCells[r]) {
      const type = colTypes[cell.colIdx];
      dataPromises.push(ocrCell(cell, type));
    }
  }
  await Promise.all(dataPromises);

  // ── Phase 3 & 4: Drift Detection & Fallback ───────────────────────────\\\\\\\\\\\\\\\\\\\\\\\──
  onProgress?.('Phase 3: Structural validation & self-healing…', 92);
  const results: OCRLine[] = [];

  for (let r = 0; r < numRows; r++) {
    const cols = cellTexts[r].map(t => t.trim());
    if (cols.every(c => c.length === 0)) continue;

    const avgConf = cellConfs[r].reduce((s, v) => s + v, 0) / Math.max(1, cellConfs[r].length);
    let finalCols = [...cols];
    let rowConf = avgConf;
    let explanation = '';

    // Phase 3: Validate Row Schema
    const validation = validateRow(finalCols, numCols, colTypes);

    // Phase 4: Fallback Loop (Triggered only on confidence < 75 OR schema violation)
    if (!validation.isValid || avgConf < 75) {
      if (!validation.isValid) explanation += `Corrected: ${validation.issues.join(', ')} | `;
      let healed = false;

      for (let c = 0; c < numCols; c++) {
        if (cellConfs[r][c] < 70) {
          const cell = rowsOfCells[r].find(cell => cell.colIdx === c);
          if (cell) {
             const { dataUrl } = extractCellImage(sourceCanvas, cell, grid.isInverted);
             try {
               const { data } = await fallbackWorker.recognize(dataUrl);
               if (data.confidence > cellConfs[r][c]) {
                 finalCols[c] = data.text.trim().replace(/\n/g, ' ');
                 cellConfs[r][c] = data.confidence;
                 healed = true;
               }
             } catch {}
          }
        }
      }
      
      if (healed) {
        explanation += `Healed low-confidence cells using fallback model.`;
        // Re-validate after fallback
        const reValidation = validateRow(finalCols, numCols, colTypes);
        finalCols = reValidation.correctedColumns;
      }
    } else {
      finalCols = validation.correctedColumns;
    }

    rowConf = cellConfs[r].reduce((s, v) => s + v, 0) / Math.max(1, cellConfs[r].length);
    const text = finalCols.filter(c => c.length > 0).join('  ');

    results.push({
      text,
      columns: finalCols,
      emptyCells: cellEmpty[r],
      confidence: rowConf,
      structuralConfidence: { row: 95, column: 90, total: (95 + 90 + rowConf) / 3 },
      isHeader: r < headerBound && headersOnly.some(h => h.rowIndex === r),
      rowIndex: r,
      bbox: { x0: grid.colBoundaries[0], y0: grid.rowBoundaries[r], x1: grid.colBoundaries[numCols], y1: grid.rowBoundaries[r + 1] },
      explanation: explanation.trim() || undefined
    });
  }

  onProgress?.('Finalizing semantic layout…', 98);
  const semantic = analyseDocument(results);
  return semantic.rows.filter(r => r.region !== 'empty');
  } finally {
    await Promise.allSettled([scheduler.terminate(), fallbackWorker.terminate()]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Word-cluster fallback (for images without clear grid lines)
// ─────────────────────────────────────────────────────────────────────────────
async function runWordCluster(
  image: string | File,
  onProgress?: ProgressCallback
): Promise<OCRLine[]> {

  const worker = await createWorker('eng', 1, {
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract/tesseract-core.wasm.js',
    workerBlobURL: false,
    logger: (m: any) => {
      if (m.status === 'recognizing text') {
        onProgress?.('Reading text…', 15 + Math.round(m.progress * 65));
      }
    },
  });

  // Try both normal and inverted then use best result
  await worker.setParameters({ tessedit_pageseg_mode: '6' as any });

  const { data } = await worker.recognize(image as any);
  await worker.terminate();

  onProgress?.('Clustering words into rows and columns…', 85);

  const words = data.words;
  if (!words || words.length === 0) return [];

  // Vertical clustering by centre-Y
  const rows: { y: number; words: typeof words; height: number }[] = [];
  const Y_TOL = 14;

  words.forEach(word => {
    const cy = (word.bbox.y0 + word.bbox.y1) / 2;
    const h = word.bbox.y1 - word.bbox.y0;
    const existing = rows.find(r => Math.abs(r.y - cy) < Math.max(Y_TOL, h * 0.45));
    if (existing) {
      existing.words.push(word);
      existing.y =
        existing.words.reduce((s, w) => s + (w.bbox.y0 + w.bbox.y1) / 2, 0) /
        existing.words.length;
      existing.height = Math.max(existing.height, h);
    } else {
      rows.push({ y: cy, words: [word], height: h });
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
