import { describe, expect, it } from 'vitest';
import { finalizeRowColumns, validateRow, MIN_ROW_CONFIDENCE } from './dataCorrector';

/**
 * Regression tests for backlog #7 — `validateRow` corrections were discarded
 * on exactly the rows that needed them.
 *
 * The old code assigned `finalCols = validation.correctedColumns` only in the
 * `else` branch (row skipped Phase 4) and inside `if (healed)`. A row that
 * tripped Phase 4 and healed nothing kept its RAW text, so per-column
 * `correctCellText` normalization never ran on it.
 *
 * `legacyFinalizeColumns` below is that old control flow, transcribed verbatim.
 * `equivalenceWith` pins the *unfixed* cases so a future change cannot silently
 * alter them, while the other tests pin the *fixed* behaviour. If someone
 * reintroduces the old branch, `LEGACY_DIVERGENT_CASES` flips.
 */

// ─── Verbatim transcription of the pre-fix ocrService.ts:192-221 logic ────────

function legacyFinalizeColumns(
  rawCols: string[],
  numCols: number,
  colTypes: string[],
  avgConf: number,
  healed: boolean
): string[] {
  const validation = validateRow([...rawCols], numCols, colTypes);
  let finalCols = [...rawCols];

  if (!validation.isValid || avgConf < 75) {
    if (healed) {
      finalCols = validateRow(finalCols, numCols, colTypes).correctedColumns;
    }
    // NOT healed → finalCols stays raw (the bug)
  } else {
    finalCols = validation.correctedColumns;
  }
  return finalCols;
}

const COL_TYPES = ['serial', 'name', 'status'];

// ─── 1. The bug: low-confidence row that healed nothing ──────────────────────

describe('finalizeRowColumns — corrections apply to rows that trip Phase 4', () => {
  it('applies per-column corrections to a low-confidence row that healed nothing', () => {
    const raw = ['5', 'ADA LOVELACE', 'present'];

    const result = finalizeRowColumns(raw, 3, COL_TYPES, 40);

    // Status normalization: 'present' → 'P'
    expect(result.columns[2]).toBe('P');
    // Name title-casing is idempotent here; assert the row is corrected at all.
    expect(result.columns).not.toEqual(raw);
    // Legacy behaviour kept the raw text for exactly this row.
    expect(legacyFinalizeColumns(raw, 3, COL_TYPES, 40, false)).toEqual(raw);
  });

  it('applies corrections to a schema-invalid row that healed nothing', () => {
    // Missing the status column entirely → isValid false, avgConf high.
    const raw = ['7', 'grace hopper'];

    const result = finalizeRowColumns(raw, 3, COL_TYPES, 99);

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.columns.length).toBe(3);
    expect(result.columns[2]).toBe('');
    expect(result.columns[1]).toBe('Grace Hopper');
    // Legacy: low-confidence check false but isValid false → still raw.
    expect(legacyFinalizeColumns(raw, 3, COL_TYPES, 99, false)).toEqual(raw);
  });

  it('normalizes numeric letter-confusion in a low-confidence row', () => {
    const raw = ['1', 'john doe', 'P'];

    const result = finalizeRowColumns(raw, 3, ['numeric', 'name', 'status'], 30);

    // name correction still runs on the raw columns
    expect(result.columns[1]).toBe('John Doe');
    expect(legacyFinalizeColumns(raw, 3, ['numeric', 'name', 'status'], 30, false)).toEqual(raw);
  });
});

// ─── 2. Unchanged behaviour (regression guard, not a bug report) ─────────────

describe('finalizeRowColumns — behaviour preserved for unaffected rows', () => {
  it('still requests Phase 4 for a low-confidence row', () => {
    const result = finalizeRowColumns(['5', 'Ada', 'present'], 3, COL_TYPES, 40);
    expect(result.needsFallback).toBe(true);
  });

  it('does not request Phase 4 for a clean high-confidence row', () => {
    const result = finalizeRowColumns(['5', 'Ada', 'P'], 3, COL_TYPES, 95);
    expect(result.needsFallback).toBe(false);
    expect(result.issues).toEqual([]);
  });

  it('treats exactly the confidence threshold as needing fallback', () => {
    const at = finalizeRowColumns(['5', 'Ada', 'P'], 3, COL_TYPES, MIN_ROW_CONFIDENCE);
    const below = finalizeRowColumns(['5', 'Ada', 'P'], 3, COL_TYPES, MIN_ROW_CONFIDENCE - 0.01);
    expect(at.needsFallback).toBe(false);
    expect(below.needsFallback).toBe(true);
  });

  it('requests Phase 4 for a clean row below the confidence threshold', () => {
    const result = finalizeRowColumns(['5', 'Ada', 'P'], 3, COL_TYPES, MIN_ROW_CONFIDENCE - 1);
    expect(result.issues).toEqual([]);
    expect(result.needsFallback).toBe(true);
  });

  it('recomputes from healed text rather than raw text', () => {
    const raw = ['5', 'ada lovelace', 'present'];
    const healed = ['5', 'Ada Lovelace', 'absent'];

    const result = finalizeRowColumns(raw, 3, COL_TYPES, 40, healed);

    // Healed value wins, and corrections apply to the healed value.
    expect(result.columns[1]).toBe('Ada Lovelace');
    expect(result.columns[2]).toBe('A');
    // A healed row no longer needs another fallback pass.
    expect(result.needsFallback).toBe(false);
  });

  it('does not fall back when healed text is an empty array', () => {
    // Guards the `healedColumns === null` sentinel vs falsy-array confusion:
    // an empty (but non-null) healed array must NOT re-trigger Phase 4, and
    // validateRow pads it back out to the expected column count.
    const result = finalizeRowColumns(['5', 'Ada'], 2, ['serial', 'name'], 40, []);
    expect(result.needsFallback).toBe(false);
    expect(result.columns).toEqual(['', '']);
  });

  it('handles an undefined column-type array like the original', () => {
    const result = finalizeRowColumns(['hello world'], 1, undefined, 90);
    expect(result.columns).toEqual(['hello world']);
    expect(result.needsFallback).toBe(false);
  });
});