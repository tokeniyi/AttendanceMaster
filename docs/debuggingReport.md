# Google Document AI Integration Boundary Diagnostics Report

This diagnostics report provides a comprehensive analysis of the import boundary violations in the Attendance Master application. It outlines the root cause of the current compilation failures during the Next.js production build and presents a safe, step-by-step resolution path that strictly preserves all business logic, OCR configurations, and semantic reconstruction features.

---

## 1. Executive Summary

During the production build process (`npm run build`), Next.js (using **Turbopack**) fails to compile because Node.js-only core modules (`fs`, `net`, `dns`, `child_process`) and enterprise-grade server libraries (`@google-cloud/documentai` and its sub-dependencies `google-gax`, `gaxios`, `google-auth-library`) are being pulled into the **Client Component Browser bundle**.

The analysis reveals that this is an **import boundary violation** caused by mixing server-only SDK orchestration and browser-safe REST execution within a single shared utility file: `src/OCR/ocrService.ts`.

---

## 2. Import Boundary Analysis & Dependency Graph

### Current Broken Import State
The diagram below illustrates how client-side components accidentally pull heavy server-only Node.js libraries into the browser bundle because they import from the same shared file `ocrService.ts`.

```mermaid
graph TD
    subgraph Browser Bundle (Client)
        A["src/app/attendance/new/page.tsx ('use client')"]
    end

    subgraph Shared Service File (Traced by Bundler)
        B["src/OCR/ocrService.ts"]
    end

    subgraph Node.js Environment (Server Only)
        C["@google-cloud/documentai"]
        D["fs (Node File System)"]
        E["path / os (Node Utilities)"]
        F["src/app/api/ocr/route.ts (API Endpoint)"]
    end

    A -- "Statically Imports performOCR" --> B
    F -- "Statically Imports performServerOCR" --> B
    B -. "Dynamic Imports parsed by Bundler" .-> C
    B -. "Dynamic Imports parsed by Bundler" .-> D
    B -. "Dynamic Imports parsed by Bundler" .-> E

    style A fill:#ff9999,stroke:#ff3333,stroke-width:2px;
    style B fill:#ffffcc,stroke:#ffcc00,stroke-width:2px;
    style C fill:#ccffcc,stroke:#33cc33,stroke-width:1px;
    style D fill:#ccffcc,stroke:#33cc33,stroke-width:1px;
    style E fill:#ccffcc,stroke:#33cc33,stroke-width:1px;
    style F fill:#ccf2ff,stroke:#33bbff,stroke-width:1px;
```

### Proposed Safe Separation
By dividing client-side actions from server-only orchestration into separate files, the client component `page.tsx` never references any file that touches server-only libraries or Node.js modules.

```mermaid
graph TD
    subgraph Browser Bundle (Client)
        A["src/app/attendance/new/page.tsx ('use client')"]
        B["src/OCR/ocrClient.ts (Browser Safe)"]
    end

    subgraph Node.js Environment (Server Only)
        C["src/OCR/ocrService.ts (Server Only)"]
        D["@google-cloud/documentai"]
        E["fs / path / os"]
        F["src/app/api/ocr/route.ts (API Endpoint)"]
    end

    A -- "Imports performOCR" --> B
    B -- "HTTP POST fetch('/api/ocr')" --> F
    F -- "Imports performServerOCR" --> C
    C -- "Imports / Runs SDK" --> D
    C -- "Imports / Reads Temp File" --> E

    style A fill:#ccffcc,stroke:#33cc33,stroke-width:2px;
    style B fill:#ccf2ff,stroke:#33bbff,stroke-width:2px;
    style C fill:#ffffcc,stroke:#ffcc00,stroke-width:2px;
    style D fill:#e6e6e6,stroke:#8c8c8c,stroke-width:1px;
    style E fill:#e6e6e6,stroke:#8c8c8c,stroke-width:1px;
    style F fill:#ffffcc,stroke:#ffcc00,stroke-width:2px;
```

---

## 3. Detailed File Inventory & Boundary Roles

| File Path | Declared Environment | Actual Contents | Role & Target Environment | Boundary Status |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/attendance/new/page.tsx` | `"use client"` | Uses React hooks, drop zones, local state, and fires the OCR call. | Client Component / UI | **Accidental importer of server code** |
| `src/app/api/ocr/route.ts` | Server | Receives `FormData`, saves file temporarily, calls `performServerOCR()`. | Server API Route | **Valid Server Boundary** |
| `src/OCR/ocrService.ts` | Mixed / Ambiguous | Exposes client progress helper `performOCR()` alongside server `performServerOCR()` / `processDocument()`. | Combined Service Utility | **Major Boundary Violation** |

---

## 4. Root Cause Analysis

The core compilation failures stem from **two related factors**:

### A. Shared-File Static Bundling
In Next.js, when a Client Component (marked with `"use client"`) imports a single export from a file, **the entire file is added to the client-side module graph**. Even if the client component only imports a browser-safe utility (e.g. `performOCR`), the bundler (Turbopack/Webpack) must process and chunk every import and export declared in that module.

### B. Dynamic Imports in the Browser Context
In `src/OCR/ocrService.ts`, dynamic imports are used within `processDocument`:
```typescript
const { DocumentProcessorServiceClient } = await import("@google-cloud/documentai");
const fs = await import("fs");
const path = await import("path");
```
While dynamic `import()` postpones execution until runtime, **it does not stop static analysis by the bundler**. 
1. Turbopack still attempts to analyze and build chunks for any potential dynamic imports targeted at the browser bundle.
2. When the compiler encounters `@google-cloud/documentai` or node internal `fs`, it tries to trace all their sub-dependencies (like `dns`, `child_process`, `net`) to build a browser-runnable chunk.
3. Because the browser environment cannot support Node-specific constructs (such as gRPC socket connections or physical disk access), the bundler aborts with:
   - `Module not found: Can't resolve 'fs'`
   - `the chunking context does not support external modules (request: node:net)`

---

## 5. Build Check Validation Logs

A clean build validation was executed using the Next.js compilation engine. Below are the key diagnostic traces extracted from the compilation failure:

```txt
Turbopack build encountered 1 warnings:
./next.config.ts
Encountered unexpected file in NFT list
A file was traced that indicates that the whole project was traced unintentionally.

Import trace:
  App Route:
    ./next.config.ts
    ./src/OCR/ocrService.ts
    ./src/app/api/ocr/route.ts

...

./node_modules/gaxios/node_modules/node-fetch/src/index.js
Code generation for chunk item errored
An error occurred while generating the chunk item [project]/node_modules/gaxios/node_modules/node-fetch/src/index.js [app-client] (ecmascript)

Caused by:
- the chunking context (unknown) does not support external modules (request: node:net)

Import traces:
  Client Component Browser:
    ./node_modules/gaxios/node_modules/node-fetch/src/index.js [Client Component Browser]
    ./node_modules/gaxios/build/cjs/src/gaxios.js [Client Component Browser]
    ./node_modules/gaxios/build/cjs/src/index.js [Client Component Browser]
    ./node_modules/google-auth-library/build/src/index.js [Client Component Browser]
    ./node_modules/google-gax/build/src/index.js [Client Component Browser]
    ./node_modules/@google-cloud/documentai/build/src/index.js [Client Component Browser]
    ./src/OCR/ocrService.ts [Client Component Browser]
    ./src/app/attendance/new/page.tsx [Client Component Browser]
```

---

## 6. Recommendations for Safe Architectural Correction

To completely resolve the build failures without altering any business logic, table parsing algorithms, or semantic analysis, the following refactoring path is recommended:

### Step 1: Create a Dedicated Client-Safe Service File
Create a new file `src/OCR/ocrClient.ts`. Move the browser-only function `performOCR` and its dependent type `ProgressCallback` here.

```typescript
// src/OCR/ocrClient.ts
import { OCRLine } from "@/OCR/ocrService";

export type ProgressCallback = (message: string, percent: number) => void;

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
    const formData = new FormData();
    formData.append("file", fileToUpload);

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
```

### Step 2: Make `ocrService.ts` a Server-Only File
Mark the top of `src/OCR/ocrService.ts` with Next.js directive `"use server"` or add the package `server-only` to guarantee it cannot be bundled into client components. Keep `processDocument`, `performServerOCR`, and their associated types/imports inside `ocrService.ts`. Since this file will now be executed exclusively on the server, **we can safely replace dynamic `import()` calls with standard static imports**, improving code readability and performance.

### Step 3: Update Imports in the Client Component
Modify the import inside `src/app/attendance/new/page.tsx` to pull `performOCR` from the new client utility instead:

```diff
-import { performOCR } from "@/OCR/ocrService";
+import { performOCR } from "@/OCR/ocrClient";
```

### Step 4: Verify the Resolution
Run the validation suite:
```bash
npm run build
```
With these three targeted changes, the client bundle will be completely uncoupled from Google SDK internals, and the build will succeed.
