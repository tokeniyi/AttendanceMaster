/**
 * OCR CLIENT SERVICE
 * ============================================================================
 * Browser-safe entry point for the OCR pipeline.
 * Communicates with Next.js API Routes to execute Google Document AI
 * without exposing GCP credentials or bundling Node.js modules in the client.
 * ============================================================================
 */

import { OCRLine } from "@/OCR/ocrService";

export type ProgressCallback = (
  message: string,
  percent: number
) => void;

/**
 * performOCR()
 * ============================================================================
 * MAIN OCR PIPELINE ENTRY POINT (CLIENT ONLY)
 * ============================================================================
 */
export async function performOCR(
  image: string | File,
  onProgress?: ProgressCallback
): Promise<OCRLine[]> {
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
