/**
 * Analytics helpers for the session success / report page.
 *
 * These are extracted from `src/app/sessions/[id]/success/page.tsx` so they
 * can be unit-tested without mocking Supabase or the DOM.
 */

/** Confidence score above which a cell is considered "high quality". */
export const HIGH_CONFIDENCE_THRESHOLD = 80;

/**
 * Computes the data-quality index as a percentage (0–100).
 *
 * When the row set is empty (e.g. navigating directly to a `pending` session
 * whose `final_table` is NULL), this returns 0 instead of `0/0 = NaN`.
 * That NaN previously leaked into the DOM as "NaN%" text and an invalid
 * `width: 'NaN%'` CSS value on the progress bar.
 */
export function computeDataQualityIndex(
  rows: { ocrConfidence?: number }[]
): number {
  if (rows.length === 0) return 0;

  const highConfidence = rows.filter(
    (r) => (r.ocrConfidence || 0) > HIGH_CONFIDENCE_THRESHOLD
  ).length;

  return Math.round((highConfidence / rows.length) * 100);
}
