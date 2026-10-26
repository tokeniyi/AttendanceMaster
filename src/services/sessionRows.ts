import type { OCRLine } from "@/OCR/ocrService";
import type { MatchResult } from "@/types";

/**
 * Combine a matcher result with the OCR line it was derived from.
 *
 * Every field the OCR pipeline produces must survive this merge. Three semantic
 * fields (`region`, `semanticConfidence`, `explanation`) were previously dropped
 * because the call site enumerated fields by hand instead of copying the line.
 * Losing `region` silently killed four features, including the "Approve All Data"
 * button, which filters on `region === 'data'` and therefore approved zero rows.
 *
 * The matcher's fields are authoritative where the two overlap: `confidence` here
 * is the *match* score, while the OCR line's own `confidence` maps to
 * `ocrConfidence`.
 */
export function mergeMatchedRow(match: MatchResult, line: OCRLine): MatchResult {
  return {
    ...match,
    columns: line.columns,
    emptyCells: line.emptyCells,
    ocrConfidence: line.confidence,
    structuralConfidence: line.structuralConfidence,
    isHeader: line.isHeader,
    bbox: line.bbox,
    rowIndex: line.rowIndex,
    region: line.region,
    semanticConfidence: line.semanticConfidence,
    explanation: line.explanation,
  };
}

/** Merge a parallel `matchMembers` result set with its OCR lines, in order. */
export function mergeMatchedRows(matches: MatchResult[], lines: OCRLine[]): MatchResult[] {
  return matches.map((match, i) => mergeMatchedRow(match, lines[i]));
}

/**
 * The rows the semantic analyser classified as tabular data.
 *
 * This is the single definition of "a row the operator can bulk-approve". Title,
 * header, metadata and footer rows are structural decoration and must never be
 * recorded as attendance.
 */
export function bulkApprovableRows(rows: MatchResult[]): MatchResult[] {
  return rows.filter(r => r.region === "data");
}
