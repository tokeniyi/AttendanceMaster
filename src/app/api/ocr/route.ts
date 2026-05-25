import { NextRequest, NextResponse } from "next/server";
import { performServerOCR } from "@/OCR/ocrService";
import fs from "fs";
import path from "path";
import os from "os";

export async function POST(req: NextRequest) {
  let tempFilePath: string | null = null;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { error: "No file uploaded. Please upload a document/image file." },
        { status: 400 }
      );
    }

    // Convert file to array buffer and then write to a temporary file
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const tempDir = os.tmpdir();
    tempFilePath = path.join(tempDir, `docai-${Date.now()}-${file.name}`);
    fs.writeFileSync(tempFilePath, buffer);

    // Call the server OCR orchestrator
    const results = await performServerOCR(tempFilePath, file.type);

    return NextResponse.json(results);
  } catch (error: any) {
    console.error("Next.js Server API OCR Exception:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process document with Google Document AI" },
      { status: 500 }
    );
  } finally {
    // Clean up the temp file if it was created
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (err) {
        console.error("Failed to delete temp file:", err);
      }
    }
  }
}
