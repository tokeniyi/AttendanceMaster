# Automation progress

## Done (cumulative)
- Backlog #17 (MAINTENANCE.md): `runWordCluster` now terminates its tesseract worker even when `recognize` throws (2026-10-29).
- Note: PRs #12–#16 (roster race, exact-match anchor, shared inferType, NaN guard, login try/catch) were already merged before this workflow started; MAINTENANCE.md's status text for them is stale.

- Grid-path worker leak: scheduler/fallback worker creation moved inside the `try` in `performOCR`, so `finally` terminates already-created workers (2026-10-30).
- Backlog #36: deleted dead `src/lib/imageProcessor.ts` (no importers; grep-verified) (2026-10-30).

## Outstanding
- Verify the fixes with `npm test` / `npm run build` (npm crashed in the cloud run; rely on the Test workflow).
- MAINTENANCE.md status refresh: several backlog items are already merged on main.
- Next small candidates: #18 (revoke object URLs in `tableSegmenter.loadImage`), #19 (preview URL revoked while displayed), #38 (version strings).
- Large items needing a plan first (docs/plans/): #13 (members/corrections RLS), #2 (auth cookie split).

## Run log

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
