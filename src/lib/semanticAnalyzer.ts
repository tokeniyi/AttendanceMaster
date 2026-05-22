/**
 * Semantic Analysis Engine
 * Post-OCR intelligence layer that transforms raw grid data into
 * semantically-understood structured document data.
 */

import { OCRLine } from '@/OCR/ocrService';

// ─── Types ───────────────────────────────────────────────────────────────────

export type DocumentRegion = 'title' | 'metadata' | 'header' | 'data' | 'footer' | 'empty';

export type ColumnType =
  | 'serial'      // Sr. No, #, row index
  | 'name'        // Full names
  | 'designation' // Job titles/roles
  | 'numeric'     // Counts, totals
  | 'percentage'  // Ratio values
  | 'date'        // Date values
  | 'status'      // Present/Absent/LWP
  | 'text'        // Generic text
  | 'unknown';

export interface ColumnSchema {
  colIndex: number;
  inferredType: ColumnType;
  label: string;             // Best inferred header label
  confidence: number;        // 0–100
  samples: string[];         // Example values from data rows
}

export interface SemanticRow extends OCRLine {
  region: DocumentRegion;
  semanticConfidence: number;  // 0–100: how certain we are of the region classification
  explanation: string;         // Human-readable reason for classification
}

export interface SemanticDocument {
  rows: SemanticRow[];
  columns: ColumnSchema[];
  tableStartIdx: number;       // First row of the actual data table
  tableEndIdx: number;
  detectedTitle: string;
  detectedMetadata: string[];
  overallConfidence: number;
}

// ─── Regex patterns ───────────────────────────────────────────────────────────

const NAME_PATTERN = /^[A-Z][a-z]+(\s[A-Z][a-z]+)+/;
const SERIAL_PATTERN = /^\d{1,3}\.?$/;
const NUMERIC_PATTERN = /^\d+(\.\d+)?$/;
const PERCENTAGE_PATTERN = /^\d{1,3}(\.\d+)?%?$/;
const DATE_PATTERN = /\d{1,2}[\/\-\.]\d{1,2}([\/\-\.]\d{2,4})?/;

const HEADER_KEYWORDS = [
  'sr', 'no', 'name', 'designation', 'total', 'working', 'days',
  'present', 'absent', 'half', 'holiday', 'sunday', 'balance', 'lwp',
  'full', 'register', 'summary', 'day', 'c.l', 's.l', 'ott', 'sce'
];

const TITLE_KEYWORDS = [
  'register', 'attendance', 'summary', 'report', 'sheet', 'record',
  'yearly', 'monthly', 'quarterly', 'school', 'department', 'company'
];

const METADATA_KEYWORDS = [
  'date', 'prepared', 'by', 'approved', 'department', 'year',
  'month', 'www.', 'http', '@', '.com', '.org', 'info'
];

const DESIGNATION_KEYWORDS = [
  'principal', 'supervisor', 'teacher', 'assistant', 'clerk',
  'officer', 'manager', 'director', 'head', 'staff', 'lecturer', 'tr.'
];

// ─── Main Analyser ────────────────────────────────────────────────────────────

export function analyseDocument(rawRows: OCRLine[]): SemanticDocument {
  if (rawRows.length === 0) {
    return {
      rows: [], columns: [], tableStartIdx: 0, tableEndIdx: 0,
      detectedTitle: '', detectedMetadata: [], overallConfidence: 0
    };
  }

  // 1. Classify each row into a document region
  const semanticRows: SemanticRow[] = rawRows.map((row, idx) =>
    classifyRow(row, idx, rawRows)
  );

  // 2. Find the table boundaries
  const tableRows = semanticRows.filter(r => r.region === 'header' || r.region === 'data');
  const tableStartIdx = tableRows.length > 0
    ? semanticRows.indexOf(tableRows[0])
    : 0;
  const tableEndIdx = tableRows.length > 0
    ? semanticRows.indexOf(tableRows[tableRows.length - 1])
    : semanticRows.length - 1;

  // 3. Extract metadata
  const detectedTitle = semanticRows
    .filter(r => r.region === 'title')
    .map(r => r.text)
    .join(' ');

  const detectedMetadata = semanticRows
    .filter(r => r.region === 'metadata')
    .map(r => r.text);

  // 4. Infer column schema from header + data rows
  const headerRows = semanticRows.filter(r => r.region === 'header');
  const dataRows = semanticRows.filter(r => r.region === 'data');
  const maxCols = Math.max(...[...headerRows, ...dataRows].map(r => r.columns?.length ?? 0), 1);

  const columns = inferColumnSchema(headerRows, dataRows, maxCols);

  // 5. Merge multi-line header fragments
  const mergedRows = mergeFragmentedHeaders(semanticRows);

  // 6. Overall confidence
  const dataConfidence = dataRows.length > 0
    ? dataRows.reduce((s, r) => s + r.confidence, 0) / dataRows.length
    : 0;
  const structureConfidence = tableRows.length > 3 ? 80 : 50;
  const overallConfidence = (dataConfidence + structureConfidence) / 2;

  return {
    rows: mergedRows,
    columns,
    tableStartIdx,
    tableEndIdx,
    detectedTitle,
    detectedMetadata,
    overallConfidence,
  };
}

// ─── Row Classification ───────────────────────────────────────────────────────

export function classifyRow(row: OCRLine, idx: number, allRows: OCRLine[]): SemanticRow {
  const text = row.text.trim();
  const cols = row.columns ?? [text];
  const lowerText = text.toLowerCase();

  // Empty
  if (text.length === 0 || cols.every(c => c.trim().length === 0)) {
    return { ...row, region: 'empty', semanticConfidence: 99, explanation: 'No text content detected' };
  }

  // Title: top rows with long single-column text containing title keywords
  if (idx < 4 && cols.length <= 2) {
    const hasTitleKw = TITLE_KEYWORDS.some(kw => lowerText.includes(kw));
    const hasMetaKw = METADATA_KEYWORDS.some(kw => lowerText.includes(kw));
    if (hasTitleKw) return { ...row, region: 'title', semanticConfidence: 90, explanation: `Contains title keyword in top region` };
    if (hasMetaKw) return { ...row, region: 'metadata', semanticConfidence: 85, explanation: `Contains metadata pattern` };
  }

  // Metadata: URLs, company info, contact details
  if (METADATA_KEYWORDS.some(kw => lowerText.includes(kw)) && cols.length <= 2) {
    return { ...row, region: 'metadata', semanticConfidence: 80, explanation: `Matches metadata pattern` };
  }

  // Header: contains multiple header keywords across columns
  const headerKwCount = HEADER_KEYWORDS.filter(kw => lowerText.includes(kw)).length;
  if (headerKwCount >= 2) {
    return { ...row, region: 'header', semanticConfidence: 90, explanation: `${headerKwCount} header keywords detected` };
  }
  if (row.isHeader && headerKwCount >= 1) {
    return { ...row, region: 'header', semanticConfidence: 75, explanation: `Geometric header + 1 keyword` };
  }

  // Footer: bottom rows with aggregates or summary text
  if (idx > allRows.length * 0.85) {
    const hasSummaryKw = ['total', 'grand', 'average', 'sum'].some(kw => lowerText.includes(kw));
    if (hasSummaryKw) return { ...row, region: 'footer', semanticConfidence: 80, explanation: 'Summary row in footer region' };
  }

  // Data: default for content rows
  return { ...row, region: 'data', semanticConfidence: 70, explanation: 'Default data row classification' };
}

// ─── Column Schema Inference ──────────────────────────────────────────────────

export function inferColumnSchema(
  headerRows: SemanticRow[],
  dataRows: SemanticRow[],
  maxCols: number
): ColumnSchema[] {
  return Array.from({ length: maxCols }, (_, colIdx) => {
    // Get header label from first header row
    const headerLabel = headerRows.length > 0
      ? (headerRows[0].columns?.[colIdx] ?? `Col ${colIdx + 1}`)
      : `Col ${colIdx + 1}`;

    // Collect sample values
    const samples = dataRows
      .map(r => r.columns?.[colIdx] ?? '')
      .filter(v => v.trim().length > 0)
      .slice(0, 10);

    const inferredType = inferType(headerLabel, samples);

    return {
      colIndex: colIdx,
      inferredType,
      label: headerLabel,
      confidence: samples.length > 3 ? 80 : 50,
      samples,
    };
  });
}

function inferType(label: string, samples: string[]): ColumnType {
  const lowerLabel = label.toLowerCase();

  if (/sr\.?|no\.?|#|serial/i.test(lowerLabel)) return 'serial';
  if (/name/i.test(lowerLabel)) return 'name';
  if (/designation|role|position|title/i.test(lowerLabel)) return 'designation';
  if (/%|percent/i.test(lowerLabel)) return 'percentage';
  if (/date|day/i.test(lowerLabel)) return 'date';
  if (/status|present|absent|lwp/i.test(lowerLabel)) return 'status';
  if (/total|working|balance|days|count/i.test(lowerLabel)) return 'numeric';

  // Infer from samples
  if (samples.length === 0) return 'unknown';
  const numericCount = samples.filter(s => NUMERIC_PATTERN.test(s.trim())).length;
  const nameCount = samples.filter(s => NAME_PATTERN.test(s.trim())).length;
  const designationCount = samples.filter(s =>
    DESIGNATION_KEYWORDS.some(d => s.toLowerCase().includes(d))
  ).length;

  if (numericCount / samples.length > 0.7) return 'numeric';
  if (nameCount / samples.length > 0.4) return 'name';
  if (designationCount / samples.length > 0.4) return 'designation';

  return 'text';
}

// ─── Fragment Merging ─────────────────────────────────────────────────────────

/**
 * Merge header rows that are fragmented across multiple consecutive rows.
 * e.g., "Total Working" + "Days" → single header row.
 */
function mergeFragmentedHeaders(rows: SemanticRow[]): SemanticRow[] {
  const result: SemanticRow[] = [];
  let i = 0;

  while (i < rows.length) {
    const row = rows[i];

    // If current and next are both headers and close in Y position, merge
    if (
      row.region === 'header' &&
      i + 1 < rows.length &&
      rows[i + 1].region === 'header' &&
      rows[i + 1].bbox &&
      row.bbox &&
      Math.abs(rows[i + 1].bbox.y0 - row.bbox.y1) < 20
    ) {
      const next = rows[i + 1];
      const mergedCols = row.columns?.map((c, ci) => {
        const nc = next.columns?.[ci] ?? '';
        return nc ? `${c} ${nc}`.trim() : c;
      }) ?? row.columns;

      result.push({
        ...row,
        columns: mergedCols,
        text: mergedCols?.join('  ') ?? row.text,
        explanation: 'Merged fragmented header rows',
      });
      i += 2; // Skip merged row
    } else {
      result.push(row);
      i++;
    }
  }

  return result;
}

// ─── Column Type UI helpers ───────────────────────────────────────────────────

export const COLUMN_TYPE_CONFIG: Record<ColumnType, { label: string; color: string }> = {
  serial:      { label: '#',           color: 'text-slate-400 bg-slate-400/10 border-slate-400/20' },
  name:        { label: 'Name',        color: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
  designation: { label: 'Role',        color: 'text-violet-400 bg-violet-400/10 border-violet-400/20' },
  numeric:     { label: '123',         color: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
  percentage:  { label: '%',           color: 'text-orange-400 bg-orange-400/10 border-orange-400/20' },
  date:        { label: 'Date',        color: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' },
  status:      { label: 'Status',      color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  text:        { label: 'Text',        color: 'text-white/40 bg-white/5 border-white/10' },
  unknown:     { label: '?',           color: 'text-rose-400 bg-rose-400/10 border-rose-400/20' },
};
