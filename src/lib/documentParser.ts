/**
 * Document Parser Layer
 * Translates raw Google Document AI responses into normalized structures
 * usable by the Attendance Master reconstruction pipeline.
 */

export interface NormalizedBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface NormalizedCell {
  text: string;
  colSpan: number;
  rowSpan: number;
  confidence: number;
  bbox?: NormalizedBBox;
  isEmpty: boolean;
}

export interface NormalizedRow {
  cells: NormalizedCell[];
  isHeader: boolean;
  bbox?: NormalizedBBox;
}

export interface NormalizedTable {
  rows: NormalizedRow[];
  bbox?: NormalizedBBox;
}

export interface NormalizedLine {
  text: string;
  confidence: number;
  bbox?: NormalizedBBox;
}

export interface NormalizedToken {
  text: string;
  confidence: number;
  bbox?: NormalizedBBox;
}

/**
 * Extracts all tables from a Google Document AI response.
 */
export function extractTables(document: any): NormalizedTable[] {
  if (!document || !document.pages) return [];

  const normalizedTables: NormalizedTable[] = [];

  for (const page of document.pages) {
    const pageWidth = page.dimension?.width || 0;
    const pageHeight = page.dimension?.height || 0;

    if (!page.tables) continue;

    for (const table of page.tables) {
      const rows: NormalizedRow[] = [];

      // 1. Process Header Rows
      if (table.headerRows) {
        for (const row of table.headerRows) {
          const cells = (row.cells || []).map((cell: any) => parseCell(cell, document.text, pageWidth, pageHeight));
          rows.push({
            cells,
            isHeader: true,
            bbox: getUnionBBox(cells.map(c => c.bbox).filter(Boolean) as NormalizedBBox[])
          });
        }
      }

      // 2. Process Body Rows
      if (table.bodyRows) {
        for (const row of table.bodyRows) {
          const cells = (row.cells || []).map((cell: any) => parseCell(cell, document.text, pageWidth, pageHeight));
          rows.push({
            cells,
            isHeader: false,
            bbox: getUnionBBox(cells.map(c => c.bbox).filter(Boolean) as NormalizedBBox[])
          });
        }
      }

      normalizedTables.push({
        rows,
        bbox: getUnionBBox(rows.map(r => r.bbox).filter(Boolean) as NormalizedBBox[])
      });
    }
  }

  return normalizedTables;
}

/**
 * Extracts all text lines from a Google Document AI response.
 */
export function extractLines(document: any): NormalizedLine[] {
  if (!document || !document.pages) return [];

  const lines: NormalizedLine[] = [];

  for (const page of document.pages) {
    const pageWidth = page.dimension?.width || 0;
    const pageHeight = page.dimension?.height || 0;

    if (!page.lines) continue;

    for (const line of page.lines) {
      const text = getTextFromAnchor(document.text, line.layout?.textAnchor);
      const confidence = extractConfidence(line.layout);
      const bbox = extractBoundingBoxes(line.layout, pageWidth, pageHeight);

      lines.push({ text, confidence, bbox });
    }
  }

  return lines;
}

/**
 * Extracts all cells across all tables from a Google Document AI response.
 */
export function extractCells(document: any): NormalizedCell[] {
  const tables = extractTables(document);
  const cells: NormalizedCell[] = [];

  for (const table of tables) {
    for (const row of table.rows) {
      cells.push(...row.cells);
    }
  }

  return cells;
}

/**
 * Extracts confidence score (0 to 100) from a layout element.
 */
export function extractConfidence(layout: any): number {
  if (!layout || layout.confidence === undefined || layout.confidence === null) {
    return 100;
  }
  return Math.round(layout.confidence * 100);
}

/**
 * Translates Google Document AI normalized coordinates into absolute bounding boxes.
 */
export function extractBoundingBoxes(layout: any, pageWidth: number, pageHeight: number): NormalizedBBox | undefined {
  if (!layout || !layout.boundingPoly) return undefined;

  const vertices = layout.boundingPoly.normalizedVertices || layout.boundingPoly.vertices || [];
  if (vertices.length === 0) return undefined;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const vertex of vertices) {
    const x = vertex.x !== undefined ? vertex.x : 0;
    const y = vertex.y !== undefined ? vertex.y : 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const isNormalized = layout.boundingPoly.normalizedVertices && layout.boundingPoly.normalizedVertices.length > 0;
  if (isNormalized && pageWidth > 0 && pageHeight > 0) {
    return {
      x0: Math.round(minX * pageWidth),
      y0: Math.round(minY * pageHeight),
      x1: Math.round(maxX * pageWidth),
      y1: Math.round(maxY * pageHeight)
    };
  }

  return {
    x0: Math.round(minX),
    y0: Math.round(minY),
    x1: Math.round(maxX),
    y1: Math.round(maxY)
  };
}

/**
 * Extracts all tokens (words) from a Google Document AI response.
 */
export function extractTokens(document: any): NormalizedToken[] {
  if (!document || !document.pages) return [];

  const tokens: NormalizedToken[] = [];

  for (const page of document.pages) {
    const pageWidth = page.dimension?.width || 0;
    const pageHeight = page.dimension?.height || 0;

    if (!page.tokens) continue;

    for (const token of page.tokens) {
      const text = getTextFromAnchor(document.text, token.layout?.textAnchor);
      const confidence = extractConfidence(token.layout);
      const bbox = extractBoundingBoxes(token.layout, pageWidth, pageHeight);

      tokens.push({ text, confidence, bbox });
    }
  }

  return tokens;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseCell(cell: any, fullText: string, pageWidth: number, pageHeight: number): NormalizedCell {
  const text = getTextFromAnchor(fullText, cell.layout?.textAnchor);
  const confidence = extractConfidence(cell.layout);
  const bbox = extractBoundingBoxes(cell.layout, pageWidth, pageHeight);

  return {
    text,
    colSpan: cell.colSpan || 1,
    rowSpan: cell.rowSpan || 1,
    confidence,
    bbox,
    isEmpty: text.length === 0
  };
}

function getTextFromAnchor(text: string | null | undefined, textAnchor: any): string {
  if (!text || !textAnchor || !textAnchor.textSegments) return "";
  let extracted = "";
  for (const segment of textAnchor.textSegments) {
    const start = parseInt(segment.startIndex || "0", 10);
    const end = parseInt(segment.endIndex || "0", 10);
    extracted += text.substring(start, end);
  }
  return extracted.trim();
}

function getUnionBBox(bboxes: NormalizedBBox[]): NormalizedBBox | undefined {
  if (bboxes.length === 0) return undefined;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const bbox of bboxes) {
    if (bbox.x0 < minX) minX = bbox.x0;
    if (bbox.y0 < minY) minY = bbox.y0;
    if (bbox.x1 > maxX) maxX = bbox.x1;
    if (bbox.y1 > maxY) maxY = bbox.y1;
  }

  return { x0: minX, y0: minY, x1: maxX, y1: maxY };
}
