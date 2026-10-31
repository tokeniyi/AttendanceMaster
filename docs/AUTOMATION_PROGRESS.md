# Automation progress

## Done (cumulative)
- Backlog #17 (MAINTENANCE.md): `runWordCluster` now terminates its tesseract worker even when `recognize` throws (2026-10-29).
- Note: PRs #12–#16 (roster race, exact-match anchor, shared inferType, NaN guard, login try/catch) were already merged before this workflow started; MAINTENANCE.md's status text for them is stale.

- Grid-path worker leak: scheduler/fallback worker creation moved inside the `try` in `performOCR`, so `finally` terminates already-created workers (2026-10-30).
- Backlog #36: deleted dead `src/lib/imageProcessor.ts` (no importers; grep-verified) (2026-10-30).

- Backlog #18: `tableSegmenter.loadImage` revokes its blob URL on load/error (2026-10-31).
- Backlog #19: preview object URL in `attendance/new/page.tsx` now tracked in a ref and revoked on replacement/unmount, not in `finally` (2026-10-31).

## Outstanding
- MAINTENANCE.md status refresh: only #18/#19/#36 marked so far; other merged items (#12–#16 etc.) still show stale text.
- Next small candidate: #38 (version strings: package.json 0.1.0 vs Sidebar v1.1.0; owner should pick the canonical version).
- Local `npm run build` fails offline (next/font cannot fetch Inter from Google Fonts); rely on the Test workflow for build.
- Large items needing a plan first (docs/plans/): #13 (members/corrections RLS), #2 (auth cookie split).

## Run log

### 2026-10-31 (Africa/Lagos) — branch claude/dev-2026-10-31
- Changed: `src/lib/tableSegmenter.ts` (#18), `src/app/attendance/new/page.tsx` (#19), `docs/MAINTENANCE.md` (status), this file.
- Owner requests: none (issue #21 has no comments; no open claude/dev- PR — #22 already merged).
- Verification: `npm ci --legacy-peer-deps` OK; `npm test` 122/122 passed; `npx tsc --noEmit` clean; `npm run build` FAILED locally only because Google Fonts (Inter) is unreachable in this sandbox — relying on the Test workflow for the build.
- Found but not changed: #38 version mismatch (needs owner's choice of canonical version); no unit tests added for the DOM-dependent fixes (vitest env is node).

### 2026-10-30 (Africa/Lagos) — branch claude/dev-2026-10-29 (PR #22, continued)
- Changed: `src/OCR/ocrService.ts` (grid-path worker leak), removed `src/lib/imageProcessor.ts` (#36), this file.
- Owner requests: none (PR #22 and issue #21 had no owner comments).
- Verification: `npm ci`/`npm install` crashed again ("Exit handler never called") and pnpm could not reach the registry (ENOTFOUND), so tests/build/tsc were NOT run locally; relying on the Test workflow.
- Found but not changed: a worker created but whose `setParameters` throws (before `addWorker`/assignment) is still not terminated; tiny window, needs a test harness to verify. MAINTENANCE.md still lists `imageProcessor.ts` (lines 49, 358, 455) — refresh with the status-text pass.

### 2026-10-29 (Africa/Lagos) — branch claude/dev-2026-10-29
- Changed: `src/OCR/ocrService.ts` (#17); created this file.
- Owner requests: none found (standing issue "Dev workflow requests" created this run).
- Verification: `npm ci --legacy-peer-deps` crashed ("Exit handler never called"), so tests/build were NOT run locally; relying on the Test workflow.
- Found but not changed: the grid path creates workers before its `try`, so a failure creating the 2nd+ worker would leak earlier ones (small follow-up).
