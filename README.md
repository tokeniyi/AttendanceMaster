# Attendance Master MVP

A modern, high-speed attendance management system for university theatre groups. Digitizes physical attendance sheets using local OCR and intelligent fuzzy matching.

## Tech Stack

- **Framework**: Next.js (App Router)
- **Styling**: Tailwind CSS
- **Database/Auth**: Supabase
- **OCR**: Tesseract.js (Local)
- **Fuzzy Matching**: Fuse.js

## Getting Started

### 1. Prerequisites
- Node.js 22 (what CI uses)
- Supabase account

### 2. Setup Database
1. Create a new project in Supabase.
2. Go to the **SQL Editor** and run the contents of `database/schema.sql`.
   - This creates the tables `members`, `attendance`, `corrections`, `import_mappings`, `sessions` and `session_versions`.
   - It also creates the functions `approve_session` (used when a session is approved) and `upsert_correction` (see *Smart Matching Logic*).
3. Create a private Storage bucket named `attendance-scans`. Scans are stored under `{user_id}/{uuid}.jpg`.

### 3. Environment Variables
Create a `.env.local` file in the root directory and add your Supabase credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### 4. Installation
```bash
npm ci --legacy-peer-deps   # or npm install --legacy-peer-deps
```

### 5. Run Locally
```bash
npm run dev
```

Other scripts: `npm test` (Vitest), `npm run typecheck`, `npm run build`.

## Core Features

- **Local OCR**: Scan attendance sheets in the browser using Tesseract.js. The image is processed on your device and is not sent to an OCR API; the scan is then stored in your private Supabase bucket. The Tesseract language data (`eng.traineddata`) is not bundled in `public/tesseract/`, so tesseract.js downloads it from its default CDN on first use.
- **Smart Matching**: Uses Fuse.js for fuzzy name matching against the member roster. Matching can prefer stored corrections (see below), but the app does not yet write new ones.
- **CSV Workflow**: Bulk import members and export attendance reports for existing administrative workflows.
- **Premium UI**: Dark-mode first design with a focus on speed and reliability.

## Smart Matching Logic
The matcher reads rows from the `corrections` table and, when an OCR'd name equals a stored `incorrect_text`, uses the linked member with 100% confidence. **Correction learning is not active yet:** the `upsert_correction` SQL function exists, but the UI never calls it, so the table is only populated if you insert rows yourself.

## Architecture
1. **Upload** (`/attendance/new`): validate the image, then run OCR.
2. **OCR pipeline** (`src/OCR/ocrService.ts`): detect the table grid (`computerVision.ts`), OCR cells with a pool of tesseract workers, classify and validate rows, and re-try low-confidence cells with a fallback worker. Without a detectable grid it falls back to word clustering.
3. **Matching** (`src/matching/matchEngine.ts`): fuzzy-match names to members.
4. **Review** (`/sessions/[id]`): edit rows with undo/redo, then approve via the `approve_session` RPC.
5. **Storage keys**: `sessions.image_url` holds the storage *key*, not a URL; a short-lived signed URL is minted when viewing.
6. **Ownership**: `sessions` rows carry `owner_id`; `members` and `corrections` are currently shared across users (see `docs/plans/members-corrections-rls.md`).

More detail and the open backlog live in `docs/MAINTENANCE.md`.

## Exporting Data
After a session is approved, the success page offers a CSV download (cells that start with `=`, `+`, `-` or `@` are prefixed with `'` to prevent spreadsheet formula injection) and the workspace can copy the table to the clipboard as tab-separated text. The **History** tab lists sessions but has no export button.
