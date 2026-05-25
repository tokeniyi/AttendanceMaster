/**
 * OCR SERVICE (GOOGLE DOCUMENT AI INTEGRATION)
 * ============================================================================
 * PURPOSE
 * ----------------------------------------------------------------------------
 * This file acts as a client-server bridge for Google Document AI integration.
 * It replaces the previous weak in-browser Tesseract OCR with an enterprise-grade
 * document reconstruction pipeline.
 *
 * It dynamically resolves client/server execution to:
 *  1. Server Side: Process files using `@google-cloud/documentai` directly.
 *  2. Client Side: Upload documents to Next.js route `/api/ocr` to avoid bundling
 *     Node libraries or exposing private GCP credentials in the browser.
 * ============================================================================
 */

import {
  analyseDocument,
  classifyRow,
  inferColumnSchema,
  type SemanticDocument
} from '@/lib/semanticAnalyzer';

import { validateRow } from '@/lib/dataCorrector';
import { extractTables, extractLines } from '@/lib/documentParser';

export type { SemanticDocument };

/**
 * OCRLine
 * ============================================================================
 * Represents ONE reconstructed row from the OCR pipeline.
 * ============================================================================
 */
export interface OCRLine {
  /**
   * Full reconstructed row text.
   */
  text: string;

  /**
   * Individual column values.
   */
  columns: string[];

  /**
   * Tracks which cells were detected as empty.
   */
  emptyCells?: boolean[];

  /**
   * OCR confidence score for entire row.
   */
  confidence: number;

  /**
   * Structural confidence scores.
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
 */
export type ProgressCallback = (
  message: string,
  percent: number
) => void;

/**
 * processDocument()
 * ============================================================================
 * SERVER-SIDE ONLY: Calls Google Document AI using base64 encoded input.
 * Dynamic imports are used to prevent client bundle compile errors.
 * ============================================================================
 */
export async function processDocument(filePath: string, mimeType?: string) {
  // Use dynamic imports to keep Node.js libraries out of the client bundle
  const { DocumentProcessorServiceClient } = await import("@google-cloud/documentai");
  const fs = await import("fs");
  const path = await import("path");

  const projectId = process.env.GOOGLE_PROJECT_ID;
  const location = process.env.GOOGLE_LOCATION;
  const processorId = process.env.GOOGLE_PROCESSOR_ID;

  if (!projectId || !location || !processorId) {
    throw new Error(
      "Missing Google Document AI configuration in environment variables. " +
      "Please verify GOOGLE_PROJECT_ID, GOOGLE_LOCATION, and GOOGLE_PROCESSOR_ID."
    );
  }

  const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;

  const clientOptions: any = {};
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Resolve relative credential path to an absolute path for robustness
    clientOptions.keyFilename = path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }

  const client = new DocumentProcessorServiceClient(clientOptions);
  const fileBuffer = fs.readFileSync(filePath);
  const encodedImage = Buffer.from(fileBuffer).toString("base64");

  const request = {
    name,
    rawDocument: {
      content: encodedImage,
      mimeType: mimeType || "image/png",
    },
  };

  const [result] = await client.processDocument(request);
  return result.document;
}

/**
 * performServerOCR()
 * ============================================================================
 * SERVER-SIDE ONLY: Orchestrates Document AI execution, invokes the parser
 * layer to structure tables/lines, and enriches data using semantic rules.
 * ============================================================================
 */
export async function performServerOCR(filePath: string, mimeType?: string): Promise<OCRLine[]> {
  // 1. Send the file to Google Document AI
  const document = await processDocument(filePath, mimeType);

  if (!document) {
    throw new Error("Failed to receive a valid response from Google Document AI.");
  }

  const results: OCRLine[] = [];

  // 2. Parse structural tables
  const normalizedTables = extractTables(document);

  if (normalizedTables.length > 0) {
    let globalRowIndex = 0;

    for (const table of normalizedTables) {
      for (const row of table.rows) {
        const columns = row.cells.map(c => c.text);
        const emptyCells = row.cells.map(c => c.isEmpty);

        // Average row confidence
        const avgConf = row.cells.reduce((sum, c) => sum + c.confidence, 0) / Math.max(1, row.cells.length);

        // Reconstruct full text
        const text = columns.filter(c => c.trim().length > 0).join("  ");

        results.push({
          text,
          columns,
          emptyCells,
          confidence: avgConf,
          structuralConfidence: {
            row: 98,
            column: 95,
            total: Math.round((98 + 95 + avgConf) / 3)
          },
          isHeader: row.isHeader,
          rowIndex: globalRowIndex++,
          bbox: row.bbox || { x0: 0, y0: 0, x1: 100, y1: 100 }
        });
      }
    }
  } else {
    // 3. Fallback: Parse line-by-line if no structural table was detected
    const normalizedLines = extractLines(document);
    let globalRowIndex = 0;

    for (const line of normalizedLines) {
      if (line.text.trim().length === 0) continue;

      results.push({
        text: line.text,
        columns: [line.text],
        emptyCells: [false],
        confidence: line.confidence,
        structuralConfidence: {
          row: 75,
          column: 50,
          total: Math.round((75 + 50 + line.confidence) / 3)
        },
        isHeader: false,
        rowIndex: globalRowIndex++,
        bbox: line.bbox || { x0: 0, y0: 0, x1: 100, y1: 100 }
      });
    }
  }

  // 4. Enrich with semantic analyzer to resolve header, footer, metadata, etc.
  const semantic = analyseDocument(results);

  // Return non-empty rows
  return semantic.rows.filter(r => r.region !== 'empty');
}

/**
 * performOCR()
 * ============================================================================
 * MAIN OCR PIPELINE ENTRY POINT (CLIENT & SERVER SENSITIVE)
 * ============================================================================
 */
export async function performOCR(
  image: string | File,
  onProgress?: ProgressCallback
): Promise<OCRLine[]> {
  // If running on the server, delegate directly to performServerOCR
  if (typeof window === "undefined") {
    throw new Error("performOCR expects client context when executed directly. For server-side usage, call performServerOCR.");
  }

  onProgress?.("Uploading document to Google Document AI…", 10);

  try {
    let fileToUpload: File;

    if (typeof image === "string") {
      onProgress?.("Fetching image resource…", 15);
      const response = await fetch(image);
      const blob = await response.blob();
      fileToUpload = new File([blob], "document.png", { type: blob.type || "image/png" });
    } else {
      fileToUpload = image;
    }

    onProgress?.("Analyzing layout using Document AI…", 40);

    // Create payload
    const formData = new FormData();
    formData.append("file", fileToUpload);

    // POST to local API Route
    const response = await fetch("/api/ocr", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OCR processing failed: ${errText || response.statusText}`);
    }

    onProgress?.("Reconstructing database spreadsheet…", 85);

    const results: OCRLine[] = await response.json();

    onProgress?.("Analysis complete!", 100);
    return results;
  } catch (error: any) {
    console.error("Client-side performOCR failure:", error);
    onProgress?.(`Error: ${error.message || "Failed processing"}`, 100);
    throw error;
  }
}