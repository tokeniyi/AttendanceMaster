# Attendance Master — Google Document AI Integration Plan

## Objective

Replace the current OCR extraction engine with Google Document AI while preserving the existing intelligent reconstruction pipeline.

The goal is NOT to rebuild the system.

The goal is to:

- Replace weak OCR extraction
- Preserve structural document understanding
- Maintain intelligent table reconstruction
- Improve reliability of attendance sheet extraction
- Prevent hallucinated cell generation
- Build a scalable OCR architecture for future AI enhancements

---

# CRITICAL ARCHITECTURE RULE

DO NOT flatten Google Document AI output into plain text immediately.

This is a major architectural mistake.

We must preserve:

- Pages
- Blocks
- Paragraphs
- Tokens
- Bounding boxes
- Coordinates
- Confidence scores
- Table structures
- Cell relationships

The reconstruction system depends heavily on structural OCR metadata.

This project is NOT a simple OCR-to-text app.

This is an intelligent document reconstruction system.

---

# Existing Project Structure

Current structure:

```txt
src/
 ├── lib/
 │    ├── computerVision.ts
 │    ├── dataCorrector.ts
 │    ├── imageProcessor.ts
 │    ├── semanticAnalyzer.ts
 │    ├── tableSegmenter.ts
 │
 ├── OCR/
 │    └── ocrService.ts
```

The architecture should remain modular.

---

# FINAL TARGET PIPELINE

The final processing flow should become:

```txt
UPLOAD
  ↓
imageProcessor.ts
  ↓
computerVision.ts
  ↓
Google Document AI
  ↓
documentParser.ts
  ↓
tableSegmenter.ts
  ↓
semanticAnalyzer.ts
  ↓
dataCorrector.ts
  ↓
Excel Export
```

---

# IMPLEMENTATION REQUIREMENTS

## 1. Install Google Document AI SDK

Install:

```bash
npm install @google-cloud/documentai
```

---

# 2. Environment Variables

Use `.env.local`

Required variables:

```env
GOOGLE_PROJECT_ID=
GOOGLE_LOCATION=
GOOGLE_PROCESSOR_ID=
GOOGLE_APPLICATION_CREDENTIALS=./google-key.json
```

DO NOT hardcode credentials anywhere.

---

# 3. Security Requirements

The JSON credentials file:

```txt
google-key.json
```

MUST:

- remain in project root
- be added to `.gitignore`
- NEVER be committed to GitHub

---

# 4. Rewrite OCR Layer

File:

```txt
src/OCR/ocrService.ts
```

This file should become a Google Document AI bridge service.

The OCR service must:

- accept uploaded image/document
- send document to Google Document AI
- return FULL structured document response
- preserve all OCR metadata
- avoid flattening response into plain text

---

# REQUIRED OCR SERVICE STRUCTURE

Implementation direction:

```ts
import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import fs from "fs";

const client = new DocumentProcessorServiceClient();

export async function processDocument(filePath: string) {
  const projectId = process.env.GOOGLE_PROJECT_ID;
  const location = process.env.GOOGLE_LOCATION;
  const processorId = process.env.GOOGLE_PROCESSOR_ID;

  const name =
    `projects/${projectId}/locations/${location}/processors/${processorId}`;

  const imageFile = fs.readFileSync(filePath);

  const encodedImage = Buffer.from(imageFile).toString("base64");

  const request = {
    name,
    rawDocument: {
      content: encodedImage,
      mimeType: "image/png",
    },
  };

  const [result] = await client.processDocument(request);

  return result.document;
}
```

---

# IMPORTANT ENGINEERING REQUIREMENT

DO NOT:

```ts
return result.document.text;
```

This destroys structure.

Instead:

```ts
return result.document;
```

The downstream pipeline requires structured metadata.

---

# 5. Create Parser Layer

Create new file:

```txt
src/lib/documentParser.ts
```

Purpose:

Translate raw Google Document AI response into normalized internal structures usable by the reconstruction pipeline.

This parser layer becomes the bridge between:

- OCR engine
AND
- intelligent reconstruction system

---

# REQUIRED PARSER FUNCTIONS

The parser layer should expose functions such as:

```ts
extractTables()
extractLines()
extractCells()
extractConfidence()
extractBoundingBoxes()
extractTokens()
```

---

# PARSER REQUIREMENTS

The parser must preserve:

- row relationships
- column relationships
- coordinates
- confidence scores
- token grouping
- table hierarchy
- page structure

The parser should normalize Google structures into reusable internal data models.

---

# 6. Preserve Existing Reconstruction Pipeline

The following systems must remain active:

```txt
computerVision.ts
tableSegmenter.ts
semanticAnalyzer.ts
dataCorrector.ts
```

Google Document AI should ENHANCE these systems.

It should NOT replace them completely.

---

# IMPORTANT DESIGN PRINCIPLE

Attendance sheets are often:

- low quality
- rotated
- skewed
- partially handwritten
- poorly bordered
- merged cells
- broken tables

Google OCR alone is insufficient.

The best approach is:

```txt
Computer Vision
+
AI OCR
+
Semantic Reconstruction
```

This hybrid architecture is required.

---

# 7. Error Handling Requirements

The implementation must safely handle:

- empty OCR responses
- invalid file types
- unsupported image formats
- API failures
- missing credentials
- rate limits
- malformed table structures

Never allow silent failures.

---

# 8. Confidence-Driven Reconstruction

The parser should preserve OCR confidence scores.

Future systems will use confidence values to:

- detect hallucinated cells
- identify uncertain text
- trigger correction logic
- validate reconstructed rows

This metadata is critical.

---

# 9. Hallucination Prevention Requirements

The reconstruction system must NEVER invent cells blindly.

The pipeline should:

- preserve original OCR evidence
- track coordinates
- track confidence
- validate semantic consistency
- mark uncertain cells explicitly

Reliability is more important than aggressive reconstruction.

---

# 10. Maintain Modularity

Avoid giant files.

Keep responsibilities separated:

## OCR Layer
Responsible ONLY for:
- communicating with Google Document AI

## Parser Layer
Responsible ONLY for:
- transforming OCR structures

## Reconstruction Layer
Responsible ONLY for:
- rebuilding logical tables

## Correction Layer
Responsible ONLY for:
- validating and fixing extracted data

---

# 11. Expected Outcome

After implementation, the system should:

- extract attendance sheets more accurately
- preserve table structures
- reduce hallucinated data
- improve reconstruction reliability
- support scalable future AI enhancements
- support confidence-aware correction systems

---

# 12. Non-Goals

DO NOT:

- flatten everything into plain text
- tightly couple OCR logic with correction logic
- hardcode document assumptions
- remove existing CV systems
- replace modular architecture with monolithic code

---

# 13. Priority Order

Priority should be:

1. Stable OCR integration
2. Structural metadata preservation
3. Parser normalization
4. Table reconstruction reliability
5. Confidence-aware correction
6. Excel export stabilization

---

# FINAL IMPLEMENTATION EXPECTATION

The implementation should behave like an enterprise-grade document reconstruction pipeline rather than a basic OCR reader.

The system should be designed for future scalability, maintainability, and intelligent reconstruction.