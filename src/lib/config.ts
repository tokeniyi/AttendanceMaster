/**
 * Central, environment-specific constants (backlog #32).
 * Keep literal bucket names and static-asset paths here so a rename is a one-line change.
 */

/** Supabase Storage bucket holding photographed attendance registers. */
export const SCANS_BUCKET = 'attendance-scans';

/** Self-hosted tesseract.js assets served from `public/tesseract/`. */
export const TESSERACT_WORKER_PATH = '/tesseract/worker.min.js';
export const TESSERACT_CORE_PATH = '/tesseract/tesseract-core.wasm.js';
