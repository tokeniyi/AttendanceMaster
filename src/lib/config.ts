/**
 * Central, environment-specific constants (backlog #32).
 * Keep literal bucket names and static-asset paths here so a rename is a one-line change.
 */

/** Supabase Storage bucket holding photographed attendance registers. */
export const SCANS_BUCKET = 'attendance-scans';

/** Self-hosted tesseract.js assets served from `public/tesseract/`. */
export const TESSERACT_WORKER_PATH = '/tesseract/worker.min.js';
/**
 * A directory (not a file) so tesseract.js picks the fastest build the device
 * supports: `tesseract-core-simd-lstm.wasm.js` with WASM SIMD, otherwise
 * `tesseract-core-lstm.wasm.js`. Both are LSTM-only builds, matching the OEM 1
 * (LSTM) engine every worker uses — smaller and ~2x faster than the generic core.
 */
export const TESSERACT_CORE_PATH = '/tesseract';
/**
 * Self-hosted pretrained English model (tessdata `best_int`, from
 * @tesseract.js-data/eng). Served gzipped and cached in IndexedDB by
 * tesseract.js after the first load, so scans work without a third-party CDN.
 */
export const TESSERACT_LANG_PATH = '/tesseract/lang';
