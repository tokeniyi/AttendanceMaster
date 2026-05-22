/**
 * Data Corrector & Normalizer
 * Post-OCR pipeline that applies linguistic and domain-specific corrections
 * to raw cell text before it reaches the human workspace.
 */

// ─── Character Confusion Map ─────────────────────────────────────────────────
// Common OCR character substitutions in printed tabular documents

const CHAR_CORRECTIONS: [RegExp, string][] = [
  // Digit / letter confusion
  [/\bO\b(?=\s*\d)/g, '0'],         // Isolated O next to digits → 0
  [/(?<=\d\s*)O\b/g, '0'],
  [/\bl\b(?=\s*\d)/gi, '1'],        // Isolated l → 1 in numeric context
  [/\bS(?=\d)/g, '5'],              // S before digit → 5
  [/(?<=\d)S\b/g, '5'],
  [/\bB(?=\d)/g, '8'],
  [/(?<=\d)B\b/g, '8'],
  [/\bl\b/g, '1'],                  // Lone l
  [/\|(?=\s*\d)/g, '1'],           // Pipe character in numeric context
  // Punctuation noise
  [/[""]/g, '"'],
  [/['']/g, "'"],
  [/—/g, '-'],
  // Table artifact noise
  [/\|{2,}/g, ''],
  [/^[\s\|\[\]\.]+$/, ''],         // Pure noise rows
];

// Attendance marker standardization
const ATTENDANCE_MARKERS: Record<string, string> = {
  'p': 'P', 'a': 'A', 'h': 'H', 'l': 'L', 'wfh': 'WFH',
  'present': 'P', 'absent': 'A', 'half': 'HD',
  'leave': 'L', 'holiday': 'H', 'sunday': 'S',
};

// ─── Cell-Level Correction ────────────────────────────────────────────────────

export function correctCellText(raw: string, colType?: string): string {
  if (!raw || raw.trim().length === 0) return '';

  let text = raw.trim();

  // 1. Strip surrounding noise characters
  text = text.replace(/^[\[\|\]\.]+/, '').replace(/[\[\|\]\.]+$/, '').trim();

  // 2. Apply column-type-specific corrections
  if (colType === 'numeric') {
    text = normalizeNumeric(text);
  } else if (colType === 'name') {
    text = normalizeName(text);
  } else if (colType === 'status') {
    text = normalizeStatus(text);
  } else if (colType === 'serial') {
    text = normalizeSerial(text);
  } else {
    // General character confusion pass
    text = applyCharCorrections(text);
  }

  return text;
}

// ─── Type-Specific Normalizers ────────────────────────────────────────────────

function normalizeNumeric(text: string): string {
  // Replace common letter→digit confusions in pure numeric fields
  let t = text
    .replace(/O/g, '0')
    .replace(/l/g, '1')
    .replace(/I/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/[,\s]/g, '');   // Remove thousand separators and spaces
  // Keep only digits and decimal point
  const num = t.replace(/[^\d.]/g, '');
  return num || text; // Fall back to original if result is empty
}

function normalizeName(text: string): string {
  let t = applyCharCorrections(text);
  // Proper case: Title Case for each word
  t = t
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
  // Remove isolated single characters that are OCR noise (not initials)
  t = t.replace(/\s[^A-Za-z\d]\s/g, ' ').trim();
  return t;
}

function normalizeStatus(text: string): string {
  const lower = text.trim().toLowerCase();
  return ATTENDANCE_MARKERS[lower] ?? text.trim().toUpperCase();
}

function normalizeSerial(text: string): string {
  // Serial numbers should be numeric
  return text.replace(/O/g, '0').replace(/l/g, '1').replace(/I/g, '1').replace(/[^\d.]/g, '');
}

function applyCharCorrections(text: string): string {
  let t = text;
  // Only apply numeric-context corrections, not blanket replacements
  t = t.replace(/\|/g, 'I');         // Pipe → I in text context
  t = t.replace(/[""]/g, '"');
  t = t.replace(/['']/g, "'");
  return t;
}

// ─── Row-Level Structural Validation ─────────────────────────────────────────

export interface RowValidation {
  isValid: boolean;
  issues: string[];
  correctedColumns: string[];
}

export function validateRow(
  columns: string[],
  expectedCols: number,
  colTypes?: string[]
): RowValidation {
  const issues: string[] = [];
  let correctedColumns = [...columns];

  // Check column count alignment
  if (columns.length < expectedCols) {
    issues.push(`Missing ${expectedCols - columns.length} column(s) — padding with empty cells`);
    while (correctedColumns.length < expectedCols) correctedColumns.push('');
  } else if (columns.length > expectedCols && expectedCols > 0) {
    issues.push(`Extra ${columns.length - expectedCols} column(s) — likely merged cell or OCR split`);
    // Attempt to merge excess columns into the last column
    const excess = correctedColumns.splice(expectedCols - 1);
    correctedColumns.push(excess.join(' '));
  }

  // Apply type-specific correction per column
  correctedColumns = correctedColumns.map((cell, i) => {
    const type = colTypes?.[i];
    return correctCellText(cell, type);
  });

  // Detect rows that are pure noise
  const allNoise = correctedColumns.every(c => c.trim().length <= 1);
  if (allNoise) issues.push('Row appears to be visual noise or separator line');

  return {
    isValid: issues.length === 0,
    issues,
    correctedColumns,
  };
}

// ─── Document-Level Consistency Check ────────────────────────────────────────

export interface DocumentValidation {
  consistentColCount: boolean;
  dominantColCount: number;
  outlierRowIndices: number[];
  overallQuality: 'high' | 'medium' | 'low';
}

export function validateDocument(
  rows: { columns: string[]; isHeader?: boolean }[]
): DocumentValidation {
  const dataRows = rows.filter(r => !r.isHeader);
  if (dataRows.length === 0) {
    return { consistentColCount: true, dominantColCount: 0, outlierRowIndices: [], overallQuality: 'low' };
  }

  // Find most common column count
  const colCounts = dataRows.map(r => r.columns.length);
  const freq: Record<number, number> = {};
  colCounts.forEach(n => { freq[n] = (freq[n] ?? 0) + 1; });
  const dominantColCount = parseInt(
    Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]
  );

  const outlierRowIndices = dataRows
    .map((r, i) => r.columns.length !== dominantColCount ? i : -1)
    .filter(i => i >= 0);

  const consistentColCount = outlierRowIndices.length / dataRows.length < 0.15;

  const overallQuality: 'high' | 'medium' | 'low' =
    outlierRowIndices.length === 0 ? 'high' :
    outlierRowIndices.length / dataRows.length < 0.3 ? 'medium' : 'low';

  return { consistentColCount, dominantColCount, outlierRowIndices, overallQuality };
}
