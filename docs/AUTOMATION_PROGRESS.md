# Automation progress

## Done (cumulative)
- Backlog #17 (MAINTENANCE.md): `runWordCluster` now terminates its tesseract worker even when `recognize` throws (2026-10-29).
- Note: PRs #12–#16 (roster race, exact-match anchor, shared inferType, NaN guard, login try/catch) were already merged before this workflow started; MAINTENANCE.md's status text for them is stale.

## Outstanding
- Verify the fix with `npm test` / `npm run build` (npm crashed in the cloud run; rely on the Test workflow).
- MAINTENANCE.md status refresh: several backlog items are already merged on main.
- Next small candidates: #18 (revoke object URLs in `tableSegmenter.loadImage`), #19 (preview URL revoked while displayed), #36 (delete dead `src/lib/imageProcessor.ts`), #38 (version strings).
- Large items needing a plan first (docs/plans/): #13 (members/corrections RLS), #2 (auth cookie split).

## Run log

### 2026-10-29 (Africa/Lagos) — branch claude/dev-2026-10-29
- Changed: `src/OCR/ocrService.ts` (#17); created this file.
- Owner requests: none found (standing issue "Dev workflow requests" created this run).
- Verification: `npm ci --legacy-peer-deps` crashed ("Exit handler never called"), so tests/build were NOT run locally; relying on the Test workflow.
- Found but not changed: the grid path creates workers before its `try`, so a failure creating the 2nd+ worker would leak earlier ones (small follow-up).
