# Automation progress

## Done (cumulative)
- Backlog #17 (MAINTENANCE.md): `runWordCluster` now terminates its tesseract worker even when `recognize` throws (2026-10-29).
- Note: PRs #12–#16 (roster race, exact-match anchor, shared inferType, NaN guard, login try/catch) were already merged before this workflow started; MAINTENANCE.md's status text for them is stale.

- Grid-path worker leak: scheduler/fallback worker creation moved inside the `try` in `performOCR`, so `finally` terminates already-created workers (2026-10-30).
- Backlog #36: deleted dead `src/lib/imageProcessor.ts` (no importers; grep-verified) (2026-10-30).

- Backlog #18: `tableSegmenter.loadImage` revokes its blob URL on load/error (2026-10-31).
- Backlog #19: preview object URL in `attendance/new/page.tsx` now tracked in a ref and revoked on replacement/unmount, not in `finally` (2026-10-31).

- Backlog #25: `ocrCell` yields to the event loop (`setTimeout 0`) every 32 cells so progress UI can paint (2026-11-01).
- Backlog #21: keyboard-handler effect in `sessions/[id]/page.tsx` now lists `history` in its deps (2026-11-02). Backlog #7, #9, #20 verified already fixed in code (2026-11-02); MAINTENANCE.md text for #7/#9 still stale.
- Backlog #30: success-page analytics computed in one `useMemo` pass (2026-11-03). Backlog #26: added `npm run typecheck` script (2026-11-03); CI wiring needs the owner (.github off-limits).

- MAINTENANCE.md status refresh: banner, headline and ✅ markers for #2–#10, #23 (2026-11-04).

## Outstanding
- Next small candidate: #38 (version strings: package.json 0.1.0 vs Sidebar v1.1.0; owner should pick the canonical version).
- Local `npm run build` fails offline (next/font cannot fetch Inter from Google Fonts); rely on the Test workflow for build.
- Large items needing a plan first (docs/plans/): #13 (members/corrections RLS), #2 (auth cookie split).

## Run log

### 2026-11-04 (Africa/Lagos) — branch claude/dev-2026-11-04
- Changed: `docs/MAINTENANCE.md` (removed stale "main is broken" banner, refreshed headline, ✅ markers for #2–#10 and #23 after checking the code/schema), this file.
- Owner requests: none (issue #21 has no comments; no open claude/dev- PR).
- Verification: `npm ci --legacy-peer-deps` OK; `npm test` 122/122 passed; `npx tsc --noEmit` clean; `npm run build` NOT run locally (known offline Google Fonts failure) — relying on the Test workflow.
- Found but not changed: #13 (RLS) still needs an owner decision on the tenancy model before a plan can be validated; #38 awaits canonical version.

### 2026-11-03 (Africa/Lagos) — branch claude/dev-2026-11-03
- Changed: `src/app/sessions/[id]/success/page.tsx` (#30), `package.json` (typecheck script, #26), `docs/MAINTENANCE.md`, this file.
- Owner requests: none (issue #21 has no comments; no open claude/dev- PR; #25 already merged).
- Verification: `npm ci --legacy-peer-deps` OK; `npm test` 122/122 passed; `npx tsc --noEmit` clean; `npm run build` NOT run locally (known offline Google Fonts failure) — relying on the Test workflow.
- Found but not changed: CI does not run `npm run typecheck` (would need a .github edit — owner to add); #38 still awaits owner's canonical version choice.

### 2026-11-02 (Africa/Lagos) — branch claude/dev-2026-11-02
- Changed: `src/app/sessions/[id]/page.tsx` (#21 deps), `docs/MAINTENANCE.md` (#20/#21 status), this file.
- Owner requests: none (issue #21 has no comments; no open claude/dev- PR; #24 already merged).
- Verification: `npm ci --legacy-peer-deps` OK; `npm test` 122/122 passed; `npx tsc --noEmit` clean; `npm run build` NOT run locally (known offline Google Fonts failure) — relying on the Test workflow.
- Found but not changed: #7 and #9 appear fixed in code but MAINTENANCE.md still lists them open (status refresh pending); no unit test for #21 (DOM/React, vitest env is node).

### 2026-11-01 (Africa/Lagos) — branch claude/dev-2026-11-01
- Changed: `src/OCR/ocrService.ts` (#25), `docs/MAINTENANCE.md` (#25 status), this file.
- Owner requests: none (issue #21 has no comments; no open claude/dev- PR; #23 already merged).
- Verification: `npm ci --legacy-peer-deps` OK; `npm test` 122/122 passed; `npx tsc --noEmit` clean; `npm run build` NOT run locally (known Google Fonts/offline failure) — relying on the Test workflow.
- Found but not changed: no unit test for the yield (DOM/canvas-dependent path; vitest env is node). #38 still awaits owner's choice of canonical version.

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
