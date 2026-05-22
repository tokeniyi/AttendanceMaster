# Attendance Master MVP

A modern, high-speed attendance management system for university theatre groups. Digitizes physical attendance sheets using local OCR and intelligent fuzzy matching.

## Tech Stack

- **Framework**: Next.js (App Router)
- **Styling**: Tailwind CSS + shadcn/ui
- **Database/Auth**: Supabase
- **OCR**: Tesseract.js (Local)
- **Fuzzy Matching**: Fuse.js

## Getting Started

### 1. Prerequisites
- Node.js 18+
- Supabase account

### 2. Setup Database
1. Create a new project in Supabase.
2. Go to the **SQL Editor** and run the contents of `database/schema.sql`.
   - This will create the necessary tables: `members`, `attendance`, `corrections`, and `import_mappings`.
   - It also creates a helper function `upsert_correction` for the smart matching logic.

### 3. Environment Variables
Create a `.env.local` file in the root directory and add your Supabase credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### 4. Installation
```bash
npm install --legacy-peer-deps
```

### 5. Run Locally
```bash
npm run dev
```

## Core Features

- **Local OCR**: Scan attendance sheets directly in the browser using Tesseract.js. No images are sent to external APIs, ensuring privacy and speed.
- **Smart Matching**: Uses Fuse.js for fuzzy name matching. Learns from manual corrections to improve accuracy over time.
- **CSV Workflow**: Bulk import members and export attendance reports for existing administrative workflows.
- **Premium UI**: Dark-mode first design with a focus on speed and reliability.

## Smart Matching Logic
If you manually correct a match (e.g., matching "Zion O." to "Zion Okonkwo"), the system stores this correction in the `corrections` table. Next time "Zion O." is seen, it will automatically prioritize the corrected match with 100% confidence.

## Exporting Data
Attendance records can be exported at any time from the **History** tab in CSV format.
