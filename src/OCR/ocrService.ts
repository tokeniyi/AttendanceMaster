/**
 * OCR SERVICE
 * ============================================================================
 * PURPOSE
 * ----------------------------------------------------------------------------
 * This file is the main OCR orchestration engine for structured table extraction.
 *
 * Main responsibilities:
 *  1. Detect table structure from an image
 *  2. Split table into cells
 *  3. OCR each cell individually using Tesseract
 *  4. Rebuild rows/columns into structured data
 *  5. Infer semantic meaning (headers/data/etc)
 *  6. Validate + self-heal suspicious OCR results
 *  7. Return cleaned structured rows
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * This system is NOT true AI reasoning.
 *
 * It is mainly:
 *  - OCR
 *  - Layout detection
 *  - Heuristics
 *  - Validation rules
 *  - Semantic inference
 *
 * Architecture Flow:
 * ----------------------------------------------------------------------------
 *
 * IMAGE
 *   ↓
 * detectTableGrid()
 *   ↓
 * extractCellImage()
 *   ↓
 * OCR each cell
 *   ↓
 * inferColumnSchema()
 *   ↓
 * validateRow()
 *   ↓
 * fallback OCR healing
 *   ↓
 * analyseDocument()
 *   ↓
 * structured OCR rows
 *
 * ============================================================================
 */

import { createWorker, createScheduler, Worker } from 'tesseract.js';

import {
  detectTableGrid,
  extractCellImage,
  renderToCanvas,
  type CellRegion,
  type TableGrid,
} from '@/lib/tableSegmenter';

import {
  analyseDocument,
  classifyRow,
  inferColumnSchema,
  type SemanticDocument
} from '@/lib/semanticAnalyzer';

import { validateRow } from '@/lib/dataCorrector';

export type { SemanticDocument };

/**
 * OCRLine
 * ============================================================================
 * Represents ONE reconstructed row from the OCR pipeline.
 *
 * Example:
 *
 * {
 *   text: "John  85  Present",
 *   columns: ["John", "85", "Present"],
 *   confidence: 92
 * }
 *
 * ============================================================================
 */
export interface OCRLine {

  /**
   * Full reconstructed row text.
   *
   * Example:
   * "John  85  Present"
   */
  text: string;

  /**
   * Individual column values.
   *
   * Example:
   * ["John", "85", "Present"]
   */
  columns: string[];

  /**
   * Tracks which cells were detected as empty.
   *
   * Example:
   * [false, true, false]
   */
  emptyCells?: boolean[];

  /**
   * OCR confidence score for entire row.
   *
   * Derived from average cell confidence.
   */
  confidence: number;

  /**
   * Structural confidence scores.
   *
   * Used to estimate how trustworthy layout reconstruction is.
   */
  structuralConfidence: {

    /**
     * Confidence that row alignment is correct.
     */
    row: number;

    /**
     * Confidence that column grouping is correct.
     */
    column: number;

    /**
     * Overall structural confidence.
     */
    total: number;
  };

  /**
   * Whether row is classified as header.
   */
  isHeader?: boolean;

  /**
   * Original row index from detected grid.
   */
  rowIndex?: number;

  /**
   * Semantic classification of row.
   */
  region?: 'title' | 'metadata' | 'header' | 'data' | 'footer' | 'empty';

  /**
   * Semantic confidence score from analyser.
   */
  semanticConfidence?: number;

  /**
   * Optional debugging explanation.
   *
   * Example:
   * "Corrected invalid numeric column"
   */
  explanation?: string;

  /**
   * Bounding box for entire row.
   */
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}

/**
 * Progress callback used by UI layer.
 *
 * Example:
 * onProgress("Reading cells...", 45)
 */
export type ProgressCallback = (
  message: string,
  percent: number
) => void;

/**
 * performOCR()
 * ============================================================================
 * MAIN OCR PIPELINE ENTRY POINT
 * ----------------------------------------------------------------------------
 *
 * This is the central orchestrator for the OCR engine.
 *
 * Responsibilities:
 *  - table detection
 *  - OCR scheduling
 *  - schema inference
 *  - validation
 *  - fallback repair
 *  - semantic analysis
 *
 * PARAMETERS
 * ----------------------------------------------------------------------------
 *
 * image:
 *  - image URL
 *  - File object
 *
 * onProgress:
 *  - optional progress callback
 *
 * RETURNS
 * ----------------------------------------------------------------------------
 *
 * Promise<OCRLine[]>
 *
 * Final structured OCR rows.
 *
 * ============================================================================
 */
export async function performOCR(
  image: string | File,
  onProgress?: ProgressCallback
): Promise<OCRLine[]> {

  /**
   * ==========================================================================
   * PHASE 0 — TABLE STRUCTURE DETECTION
   * ==========================================================================
   *
   * Goal:
   *  Detect row/column grid before OCR begins.
   *
   * Why this matters:
   *  OCRing entire table at once causes:
   *   - merged rows
   *   - wrong columns
   *   - hallucinated structure
   *
   * Instead:
   *  detect grid first
   *  OCR cell-by-cell
   *
   * ==========================================================================
   */

  onProgress?.('Analysing layout graph…', 5);

  /**
   * detectTableGrid()
   *
   * Attempts to detect:
   *  - row boundaries
   *  - column boundaries
   *  - individual cell regions
   */
  const grid = await detectTableGrid(image);

  /**
   * FALLBACK CONDITION
   * --------------------------------------------------------------------------
   * If no proper table structure is detected:
   *
   *  → switch to word-cluster mode
   *
   * This mode:
   *  - detects words directly
   *  - groups them by spacing
   *
   * Less accurate than cell OCR.
   */
  if (!grid || grid.cells.length === 0) {

    onProgress?.(
      'No clear grid detected — using adaptive word-cluster mode…',
      15
    );

    const rawLines = await runWordCluster(image, onProgress);

    /**
     * Final semantic analysis pass.
     */
    const semantic = analyseDocument(rawLines);

    /**
     * Remove empty rows before returning.
     */
    return semantic.rows.filter(r => r.region !== 'empty');
  }

  onProgress?.(
    `Layout mapped — ${grid.cells.length} cells detected`,
    15
  );

  /**
   * Render source image into canvas.
   *
   * Used later for:
   *  - cell cropping
   *  - image extraction
   */
  const sourceCanvas = await renderToCanvas(image);

  /**
   * ==========================================================================
   * PHASE 1 — PARALLEL OCR WORKER INITIALIZATION
   * ==========================================================================
   *
   * Goal:
   *  OCR many cells simultaneously.
   *
   * Why:
   *  Sequential OCR is slow.
   *
   * Example:
   *
   * BAD:
   *  Cell1 → Cell2 → Cell3
   *
   * GOOD:
   *  Worker1 → Cell1
   *  Worker2 → Cell2
   *  Worker3 → Cell3
   *
   * ==========================================================================
   */

  /**
   * Adaptive scaling based on hardware.
   *
   * navigator.hardwareConcurrency:
   *  number of logical CPU cores.
   */
  const maxWorkers =
    typeof navigator !== 'undefined' &&
    navigator.hardwareConcurrency
      ? Math.min(4, navigator.hardwareConcurrency - 1)
      : 2;

  /**
   * Ensure at least one worker exists.
   */
  const numWorkers = Math.max(1, maxWorkers);

  /**
   * Scheduler coordinates multiple OCR workers.
   */
  const scheduler = createScheduler();

  /**
   * PRIMARY OCR WORKERS
   * --------------------------------------------------------------------------
   *
   * These workers process most cells.
   *
   * PSM 7:
   *  "Treat image as single text line"
   *
   * This is ideal because each cell should contain:
   *  - one value
   *  - one line
   */
  for (let i = 0; i < numWorkers; i++) {

    const w = await createWorker(
      'eng',
      1,
      {
        workerPath: '/tesseract/worker.min.js',
        corePath: '/tesseract/tesseract-core.wasm.js',
        workerBlobURL: false
      }
    );

    await w.setParameters({

      /**
       * PSM 7 = single text line
       */
      tessedit_pageseg_mode: '7' as any,

      /**
       * Restrict character set.
       *
       * Helps reduce hallucinations.
       */
      tessedit_char_whitelist:
        '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,/-()% ',

      /**
       * Prevent weird spacing reconstruction.
       */
      preserve_interword_spaces: '0' as any
    });

    scheduler.addWorker(w);
  }

  /**
   * FALLBACK OCR WORKER
   * --------------------------------------------------------------------------
   *
   * Used ONLY for suspicious cells.
   *
   * PSM 8:
   *  "Treat image as single word"
   *
   * Sometimes better for:
   *  - noisy cells
   *  - tiny text
   *  - broken OCR regions
   */
  const fallbackWorker = await createWorker(
    'eng',
    1,
    {
      workerPath: '/tesseract/worker.min.js',
      corePath: '/tesseract/tesseract-core.wasm.js',
      workerBlobURL: false
    }
  );

  await fallbackWorker.setParameters({

    /**
     * PSM 8 = single word
     */
    tessedit_pageseg_mode: '8' as any,

    tessedit_char_whitelist:
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,/-()% ',

    preserve_interword_spaces: '0' as any
  });

  /**
   * ==========================================================================
   * TABLE DIMENSIONS
   * ==========================================================================
   */

  /**
   * Total detected rows.
   */
  const numRows = grid.rowBoundaries.length - 1;

  /**
   * Total detected columns.
   */
  const numCols = grid.colBoundaries.length - 1;

  /**
   * OCR TEXT STORAGE
   * --------------------------------------------------------------------------
   * 2D arrays storing OCR output.
   */

  /**
   * Stores extracted text.
   */
  const cellTexts: string[][] =
    Array.from(
      { length: numRows },
      () => Array(numCols).fill('')
    );

  /**
   * Stores OCR confidence scores.
   */
  const cellConfs: number[][] =
    Array.from(
      { length: numRows },
      () => Array(numCols).fill(0)
    );

  /**
   * Tracks empty cells.
   */
  const cellEmpty: boolean[][] =
    Array.from(
      { length: numRows },
      () => Array(numCols).fill(false)
    );

  /**
   * ==========================================================================
   * ROW GROUPING
   * ==========================================================================
   *
   * Organizes cells row-by-row.
   *
   * Useful for:
   *  - schema analysis
   *  - row reconstruction
   *  - validation
   */

  const rowsOfCells: CellRegion[][] =
    Array.from(
      { length: numRows },
      () => []
    );

  grid.cells.forEach(c =>
    rowsOfCells[c.rowIdx].push(c)
  );

  /**
   * Progress tracking.
   */
  const totalCells = grid.cells.length;
  let done = 0;

  /**
   * ==========================================================================
   * OCR CELL FUNCTION
   * ==========================================================================
   *
   * Core OCR logic for ONE cell.
   *
   * Responsibilities:
   *  - crop cell image
   *  - detect empty cells
   *  - run OCR
   *  - clean output
   *  - store confidence
   *
   * ==========================================================================
   */
  const ocrCell = async (
    cell: CellRegion,
    semanticType?: string
  ) => {

    /**
     * Extract cropped image for this cell.
     */
    const {
      dataUrl,
      analysis
    } = extractCellImage(
      sourceCanvas,
      cell,
      grid.isInverted
    );

    /**
     * ========================================================================
     * EMPTY CELL SUPPRESSION
     * ========================================================================
     *
     * VERY IMPORTANT ANTI-HALLUCINATION STEP
     *
     * Without this:
     *  blank cells often become:
     *   - /
     *   - I
     *   - .
     *   - 7
     *
     * OCR hallucinates noise as text.
     *
     * =========================================================================
     */
    if (analysis.isEmpty) {

      cellTexts[cell.rowIdx][cell.colIdx] = '';

      /**
       * 100 confidence because system strongly believes cell is empty.
       */
      cellConfs[cell.rowIdx][cell.colIdx] = 100;

      cellEmpty[cell.rowIdx][cell.colIdx] = true;

      done++;

      if (done % 5 === 0 || done === totalCells) {

        onProgress?.(
          `Extracting structured data (${done}/${totalCells})…`,
          20 + Math.round((done / totalCells) * 70)
        );
      }

      return;
    }

    /**
     * ========================================================================
     * PRIMARY OCR EXECUTION
     * ========================================================================
     */
    try {

      /**
       * Scheduler automatically distributes jobs
       * across workers.
       */
      const { data } =
        await scheduler.addJob('recognize', dataUrl);

      /**
       * Basic cleanup.
       */
      let text =
        data.text
          .trim()
          .replace(/\n/g, ' ');

      /**
       * NUMERIC COLUMN CLEANUP
       * ----------------------------------------------------------------------
       *
       * If semantic system believes column should be numeric:
       *  remove alphabet characters aggressively.
       *
       * Example:
       *  "9O" → "9"
       *
       * NOTE:
       *  This can sometimes create false-valid numbers.
       */
      if (semanticType === 'numeric') {

        text = text.replace(
          /[^0-9.\-]/g,
          ''
        );
      }

      /**
       * Store OCR result.
       */
      cellTexts[cell.rowIdx][cell.colIdx] = text;

      /**
       * Store OCR confidence.
       */
      cellConfs[cell.rowIdx][cell.colIdx] =
        data.confidence;

    } catch {

      /**
       * OCR failures silently ignored.
       */
    }

    done++;

    /**
     * Progress reporting.
     */
    if (done % 5 === 0 || done === totalCells) {

      onProgress?.(
        `Extracting structured data (${done}/${totalCells})…`,
        20 + Math.round((done / totalCells) * 70)
      );
    }
  };

  /**
   * ==========================================================================
   * PHASE 1 — HEADER DISCOVERY + SCHEMA LOCKING
   * ==========================================================================
   *
   * Goal:
   *  Understand table structure BEFORE processing all data.
   *
   * Strategy:
   *  OCR first few rows only.
   *
   * Then infer:
   *  - headers
   *  - data types
   *  - schema patterns
   *
   * ==========================================================================
   */

  onProgress?.(
    'Phase 1: Inferring layout schema…',
    20
  );

  /**
   * Maximum rows used for header inference.
   */
  const headerBound = Math.min(4, numRows);

  const headerPromises: Promise<void>[] = [];

  /**
   * OCR first few rows.
   */
  for (let r = 0; r < headerBound; r++) {

    for (const cell of rowsOfCells[r]) {

      headerPromises.push(
        ocrCell(cell)
      );
    }
  }

  /**
   * Wait until all header cells finish OCR.
   */
  await Promise.all(headerPromises);

  /**
   * ==========================================================================
   * TEMP HEADER ANALYSIS
   * ==========================================================================
   */

  const tempHeaderRows = [];

  for (let r = 0; r < headerBound; r++) {

    const cols =
      cellTexts[r].map(t => t.trim());

    /**
     * Ignore fully empty rows.
     */
    if (cols.every(c => c.length === 0)) continue;

    /**
     * Reconstruct row text.
     */
    const text =
      cols
        .filter(c => c.length > 0)
        .join('  ');

    /**
     * Temporary OCR row object.
     */
    const rowObj: OCRLine = {

      text,

      columns: cols,

      emptyCells: cellEmpty[r],

      confidence: 100,

      isHeader: false,

      rowIndex: r,

      structuralConfidence: {
        row: 100,
        column: 100,
        total: 100
      },

      bbox: {
        x0: grid.colBoundaries[0],
        y0: grid.rowBoundaries[r],
        x1: grid.colBoundaries[numCols],
        y1: grid.rowBoundaries[r+1]
      }
    };

    /**
     * classifyRow()
     *
     * Attempts to determine:
     *  - header
     *  - data
     *  - title
     *  - footer
     */
    tempHeaderRows.push(
      classifyRow(
        rowObj,
        r,
        [rowObj]
      )
    );
  }

  /**
   * Separate rows by semantic type.
   */
  const headersOnly =
    tempHeaderRows.filter(
      r => r.region === 'header'
    );

  const dataOnly =
    tempHeaderRows.filter(
      r => r.region === 'data'
    );

  /**
   * inferColumnSchema()
   *
   * Attempts to learn:
   *  - numeric columns
   *  - text columns
   *  - dates
   *  - totals
   * etc.
   */
  const colSchemas =
    inferColumnSchema(
      headersOnly,
      dataOnly,
      numCols
    );

  /**
   * Final inferred types.
   */
  const colTypes =
    colSchemas.map(
      (c: any) => c.inferredType
    );

  /**
   * ==========================================================================
   * PHASE 2 — FULL DATA OCR
   * ==========================================================================
   *
   * OCR remaining rows using learned schema.
   *
   * Example:
   *  numeric columns receive stricter cleanup.
   *
   * ==========================================================================
   */

  onProgress?.(
    'Phase 2: Parallel data extraction…',
    30
  );

  const dataPromises: Promise<void>[] = [];

  for (let r = headerBound; r < numRows; r++) {

    for (const cell of rowsOfCells[r]) {

      const type =
        colTypes[cell.colIdx];

      dataPromises.push(
        ocrCell(cell, type)
      );
    }
  }

  /**
   * Wait until all OCR jobs finish.
   */
  await Promise.all(dataPromises);

  /**
   * ==========================================================================
   * PHASE 3 + 4 — VALIDATION + SELF HEALING
   * ==========================================================================
   *
   * Goal:
   *  detect suspicious OCR results
   *  retry low-confidence cells
   *
   * ==========================================================================
   */

  onProgress?.(
    'Phase 3: Structural validation & self-healing…',
    92
  );

  const results: OCRLine[] = [];

  /**
   * Process rows one-by-one.
   */
  for (let r = 0; r < numRows; r++) {

    const cols =
      cellTexts[r].map(
        t => t.trim()
      );

    /**
     * Skip fully empty rows.
     */
    if (cols.every(c => c.length === 0)) continue;

    /**
     * Average row confidence.
     */
    const avgConf =
      cellConfs[r].reduce((s, v) => s + v, 0) /
      Math.max(1, cellConfs[r].length);

    let finalCols = [...cols];

    let rowConf = avgConf;

    /**
     * Debug explanation string.
     */
    let explanation = '';

    /**
     * ========================================================================
     * PHASE 3 — ROW VALIDATION
     * ========================================================================
     *
     * validateRow():
     *  checks schema consistency.
     */
    const validation =
      validateRow(
        finalCols,
        numCols,
        colTypes
      );

    /**
     * ========================================================================
     * PHASE 4 — FALLBACK SELF HEALING
     * ========================================================================
     *
     * Triggered if:
     *  - row confidence low
     *  - schema invalid
     *
     * =========================================================================
     */
    if (!validation.isValid || avgConf < 75) {

      if (!validation.isValid) {

        explanation +=
          `Corrected: ${validation.issues.join(', ')} | `;
      }

      let healed = false;

      /**
       * Retry suspicious cells only.
       */
      for (let c = 0; c < numCols; c++) {

        /**
         * Only retry low-confidence cells.
         */
        if (cellConfs[r][c] < 70) {

          const cell =
            rowsOfCells[r].find(
              cell => cell.colIdx === c
            );

          if (cell) {

            const { dataUrl } =
              extractCellImage(
                sourceCanvas,
                cell,
                grid.isInverted
              );

            try {

              /**
               * Retry OCR using fallback worker.
               */
              const { data } =
                await fallbackWorker.recognize(dataUrl);

              /**
               * Replace old result if confidence improved.
               *
               * NOTE:
               *  Tesseract confidence is NOT always reliable.
               */
              if (data.confidence > cellConfs[r][c]) {

                finalCols[c] =
                  data.text
                    .trim()
                    .replace(/\n/g, ' ');

                cellConfs[r][c] =
                  data.confidence;

                healed = true;
              }

            } catch {}
          }
        }
      }

      /**
       * Revalidate after healing.
       */
      if (healed) {

        explanation +=
          `Healed low-confidence cells using fallback model.`;

        const reValidation =
          validateRow(
            finalCols,
            numCols,
            colTypes
          );

        finalCols =
          reValidation.correctedColumns;
      }

    } else {

      /**
       * Accept corrected validation columns.
       */
      finalCols =
        validation.correctedColumns;
    }

    /**
     * Recompute row confidence.
     */
    rowConf =
      cellConfs[r].reduce((s, v) => s + v, 0) /
      Math.max(1, cellConfs[r].length);

    /**
     * Reconstruct final row text.
     */
    const text =
      finalCols
        .filter(c => c.length > 0)
        .join('  ');

    /**
     * Push final OCR row.
     */
    results.push({

      text,

      columns: finalCols,

      emptyCells: cellEmpty[r],

      confidence: rowConf,

      structuralConfidence: {
        row: 95,
        column: 90,
        total: (95 + 90 + rowConf) / 3
      },

      isHeader:
        r < headerBound &&
        headersOnly.some(h => h.rowIndex === r),

      rowIndex: r,

      bbox: {
        x0: grid.colBoundaries[0],
        y0: grid.rowBoundaries[r],
        x1: grid.colBoundaries[numCols],
        y1: grid.rowBoundaries[r + 1]
      },

      explanation:
        explanation.trim() || undefined
    });
  }

  /**
   * ==========================================================================
   * CLEANUP
   * ==========================================================================
   *
   * Prevent memory leaks.
   */

  await scheduler.terminate();

  await fallbackWorker.terminate();

  /**
   * ==========================================================================
   * FINAL SEMANTIC ANALYSIS
   * ==========================================================================
   *
   * Final document understanding pass.
   *
   * Determines:
   *  - titles
   *  - metadata
   *  - headers
   *  - footers
   *  - empty rows
   */

  onProgress?.(
    'Finalizing semantic layout…',
    98
  );

  const semantic =
    analyseDocument(results);

  /**
   * Remove empty rows before returning.
   */
  return semantic.rows.filter(
    r => r.region !== 'empty'
  );
}

/**
 * ============================================================================
 * WORD CLUSTER FALLBACK MODE
 * ============================================================================
 *
 * Used ONLY when no proper table grid is detected.
 *
 * Instead of:
 *  detecting cell boxes
 *
 * This mode:
 *  1. OCRs entire image
 *  2. extracts individual words
 *  3. groups nearby words into rows
 *  4. estimates columns from spacing
 *
 * Less accurate than proper grid OCR.
 *
 * ============================================================================
 */
async function runWordCluster(
  image: string | File,
  onProgress?: ProgressCallback
): Promise<OCRLine[]> {

  /**
   * Single fallback OCR worker.
   */
  const worker = await createWorker(
    'eng',
    1,
    {
      workerPath: '/tesseract/worker.min.js',
      corePath: '/tesseract/tesseract-core.wasm.js',
      workerBlobURL: false,

      /**
       * Progress logger.
       */
      logger: (m: any) => {

        if (m.status === 'recognizing text') {

          onProgress?.(
            'Reading text…',
            15 + Math.round(m.progress * 65)
          );
        }
      },
    }
  );

  /**
   * PSM 6:
   *  "Assume uniform block of text"
   */
  await worker.setParameters({
    tessedit_pageseg_mode: '6' as any
  });

  /**
   * OCR entire image.
   */
  const { data } =
    await worker.recognize(image as any);

  await worker.terminate();

  onProgress?.(
    'Clustering words into rows and columns…',
    85
  );

  /**
   * Individual OCR words.
   */
  const words = data.words;

  if (!words || words.length === 0) return [];

  /**
   * ==========================================================================
   * VERTICAL ROW CLUSTERING
   * ==========================================================================
   *
   * Group words by Y coordinate.
   */

  const rows: {
    y: number;
    words: typeof words;
    height: number
  }[] = [];

  /**
   * Y-axis tolerance.
   */
  const Y_TOL = 14;

  words.forEach(word => {

    /**
     * Center Y position.
     */
    const cy =
      (word.bbox.y0 + word.bbox.y1) / 2;

    /**
     * Word height.
     */
    const h =
      word.bbox.y1 - word.bbox.y0;

    /**
     * Attempt to place word into existing row.
     */
    const existing =
      rows.find(
        r =>
          Math.abs(r.y - cy) <
          Math.max(Y_TOL, h * 0.45)
      );

    if (existing) {

      /**
       * Add word into existing row cluster.
       */
      existing.words.push(word);

      /**
       * Recompute row center.
       */
      existing.y =
        existing.words.reduce(
          (s, w) =>
            s +
            (w.bbox.y0 + w.bbox.y1) / 2,
          0
        ) / existing.words.length;

      /**
       * Track largest height.
       */
      existing.height =
        Math.max(existing.height, h);

    } else {

      /**
       * Create new row cluster.
       */
      rows.push({
        y: cy,
        words: [word],
        height: h
      });
    }
  });

  /**
   * Sort rows top-to-bottom.
   */
  const sortedRows =
    rows.sort((a, b) => a.y - b.y);

  const results: OCRLine[] = [];

  /**
   * ==========================================================================
   * COLUMN GROUPING
   * ==========================================================================
   */

  sortedRows.forEach((row, idx) => {

    /**
     * Sort words left-to-right.
     */
    const rowWords =
      row.words.sort(
        (a, b) => a.bbox.x0 - b.bbox.x0
      );

    const columns: string[] = [];

    let currentGroup: string[] = [];

    rowWords.forEach((word, wIdx) => {

      const prev = rowWords[wIdx - 1];

      /**
       * Horizontal spacing gap.
       */
      const gap =
        prev
          ? word.bbox.x0 - prev.bbox.x1
          : 0;

      /**
       * Large gap means new column.
       */
      if (
        wIdx > 0 &&
        gap > row.height * 1.5
      ) {

        columns.push(
          currentGroup.join(' ').trim()
        );

        currentGroup = [word.text];

      } else {

        currentGroup.push(word.text);
      }
    });

    /**
     * Push final group.
     */
    if (currentGroup.length) {

      columns.push(
        currentGroup.join(' ').trim()
      );
    }

    /**
     * Basic cleanup.
     */
    const clean =
      columns
        .map(c =>
          c
            .replace(/^[\[\|]+/, '')
            .replace(/[\]\|]+$/, '')
            .trim()
        )
        .filter(c => c.length > 0);

    /**
     * Ignore empty rows.
     */
    if (clean.length === 0) return;

    /**
     * Average OCR confidence.
     */
    const avgConf =
      rowWords.reduce(
        (s, w) => s + w.confidence,
        0
      ) / rowWords.length;

    /**
     * Measures vertical alignment quality.
     */
    const rowYVar =
      rowWords.reduce(
        (s, w) =>
          s +
          Math.abs(
            (w.bbox.y0 + w.bbox.y1) / 2 - row.y
          ),
        0
      ) / rowWords.length;

    /**
     * Final reconstructed OCR row.
     */
    results.push({

      text: clean.join('  '),

      columns: clean,

      confidence: avgConf,

      structuralConfidence: {

        /**
         * Better vertical consistency = better confidence.
         */
        row: Math.max(0, 100 - rowYVar * 5),

        /**
         * Multiple columns usually means better structure.
         */
        column: clean.length > 1 ? 75 : 50,

        total:
          (
            Math.max(0, 100 - rowYVar * 5) +
            (clean.length > 1 ? 75 : 50) +
            avgConf
          ) / 3,
      },

      /**
       * Basic heuristic header detection.
       */
      isHeader:
        idx < 2 ||

        clean.some(c =>
          [
            'name',
            'sr',
            'designation',
            'total',
            'present',
            'register'
          ].some(
            k =>
              c.toLowerCase().includes(k)
          )
        ),

      rowIndex: idx,

      bbox: {

        x0:
          Math.min(
            ...rowWords.map(w => w.bbox.x0)
          ),

        y0:
          Math.min(
            ...rowWords.map(w => w.bbox.y0)
          ),

        x1:
          Math.max(
            ...rowWords.map(w => w.bbox.x1)
          ),

        y1:
          Math.max(
            ...rowWords.map(w => w.bbox.y1)
          ),
      },
    });
  });

  onProgress?.(
    'Extraction complete!',
    100
  );

  return results;
}