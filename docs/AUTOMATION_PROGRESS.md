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

- Backlog #15 (partial): dashboard (`src/app/page.tsx`) runs its three counts and recent-sessions query in one `Promise.all` and selects only rendered columns (2026-11-05).

- Backlog #29: roster/corrections selects narrowed in `attendance/new`, `sessions/[id]`, `members` pages; `Member.created_at`, `Correction.frequency/created_at` made optional (2026-11-06).
- Backlog #34 (partial): sidebar Logout button now calls `supabase.auth.signOut()` and hard-navigates to `/login` (2026-11-07).

- Backlog #14: history delete now goes through `deleteSessionAndScan` (removes the scan object after the row, rolls back UI and alerts if the row delete fails) (2026-11-08).

- Backlog #22: added `detectInverted` (mean-luminance polarity check) in `computerVision.ts`; `detectTableGrid` now binarizes with it and sets `grid.isInverted`, so dark-background scans are flipped per cell (2026-11-09).

- Backlog #32: bucket name and tesseract worker/core paths moved into `src/lib/config.ts` and used by ocrService, attendance/new, sessions/[id], sessionDeletion (2026-11-11).

- New finding (CSV injection): CSV exports (`success/page.tsx` download, `csvService.exportAttendanceCSV`) now go through `toSafeCSV` (papaparse `escapeFormulae`), so cells starting with = + - @ are prefixed with `'` (2026-11-12).

- New finding (member CSV import): `parseMemberCSV` now whitelists columns (full_name/aliases/department/email), trims, splits `;`/`|` aliases into an array, skips nameless rows; members page alerts on empty import (2026-11-13).

## Outstanding
- #15 remainder: history page needs `suggested_table` only for a row count — add a `rows` count column or RPC before narrowing/paginating.
- #34 remainder: dead 'Add Member', row edit/trash, history 'Filter', hardcoded 'Recent Workspaces' links in Sidebar — owner should decide implement vs remove.
- #14 follow-up: the repo has no storage policies; owner must confirm `storage.objects` allows owners to DELETE under `attendance-scans/{uid}/` (else scan removal logs an error). A DB trigger is the stricter alternative.
- Next small candidate: #38 (version strings: package.json 0.1.0 vs Sidebar v1.1.0; owner should pick the canonical version).
- Local `npm run build` fails offline (next/font cannot fetch Inter from Google Fonts); rely on the Test workflow for build.
- #13: plan written and validated (docs/plans/members-corrections-rls.md); owner must confirm per-user vs shared roster, then Stage 1 (add nullable `owner_id` default `auth.uid()` to members/corrections in schema.sql) can start. Do not ship Stage 3 (tight policies) before the owner backfills.
- Finding: `upsert_correction` is never called by the app, so the corrections table is never written (correction learning is dormant). Owner to decide implement vs remove (README claim, #31).
- Large items still needing a plan: #2 (auth cookie split).

## Run log

### 2026-11-13 (Africa/Lagos) — branch claude/dev-2026-11-13
- Changed: `src/services/csvService.ts` (+`sanitizeMemberRows`), `src/services/csvService.test.ts` (+2 cases), `src/app/members/page.tsx` (empty-import alert, log insert error), this file.
- Owner requests: none (issue #21 has no comments; no open claude/dev- PR).
- Verification: `npm ci --legacy-peer-deps` OK; `npm test` 135/135 passed; `npx tsc --noEmit` clean; `npm run build` NOT run locally (known offline Google Fonts failure) — relying on the Test workflow.
- Found but not changed: email format is not validated; duplicate names in a CSV/roster are not de-duplicated. Other outstanding items unchanged.

### 2026-11-12 (Africa/Lagos) — branch claude/dev-2026-11-12
- Changed: `src/services/csvService.ts` (+`toSafeCSV`), `src/app/sessions/[id]/success/page.tsx` (uses it; dropped direct Papa import), new `src/services/csvService.test.ts` (3 cases), this file.
- Owner requests: none (issue #21 has no comments; no open claude/dev- PR).
- Verification: `npm ci --legacy-peer-deps` OK; `npm test` 133/133 passed; `npx tsc --noEmit` clean; `npm run build` NOT run locally (known offline Google Fonts failure) — relying on the Test workflow.
- Found but not changed: exported member CSV import (`parseMemberCSV`) trusts column names/values unvalidated (members page); leading `-` in a cell (e.g. negative numbers) is now quote-prefixed, acceptable for attendance text. Other outstanding items unchanged.

### 2026-11-11 (Africa/Lagos) — branch claude/dev-2026-11-11
- Changed: new `src/lib/config.ts`; `src/OCR/ocrService.ts`, `src/app/attendance/new/page.tsx`, `src/app/sessions/[id]/page.tsx`, `src/services/sessionDeletion.ts` now import the constants (#32; behaviour unchanged); `docs/MAINTENANCE.md`; this file.
- Owner requests: none (issue #21 has no comments; no open claude/dev- PR).
- Verification: existing `node_modules` used; `npm test` 130/130 passed; `npx tsc --noEmit` clean; `npm run build` NOT run locally (known offline Google Fonts failure) — relying on the Test workflow.
- Found but not changed: #37 magic numbers (OCR quality tuning, needs fixtures), #33 layout nesting (needs visual check). Other outstanding items unchanged.

### 2026-11-10 (Africa/Lagos) — branch claude/dev-2026-11-10
- Changed: new `docs/plans/members-corrections-rls.md` (#13 plan, validated against schema.sql and all roster call sites), this file. Docs only; no code touched.
- Owner requests: none (issue #21 has no comments; no open claude/dev- PR).
- Plan validation: checked every `members`/`corrections` query (no app filter changes needed), CSV insert needs `owner_id` default, corrections UNIQUE must become per-owner, `approve_session` FK bypass of RLS needs a member-ownership check, backfill needs owner action.
- Verification: `npm ci --legacy-peer-deps` OK; tests/build not re-run (docs-only change).
- Found but not changed: `upsert_correction` is dead (never called). Other outstanding items unchanged.

### 2026-11-09 (Africa/Lagos) — branch claude/dev-2026-11-09
- Changed: `src/lib/computerVision.ts` (+`detectInverted`), `src/lib/tableSegmenter.ts`, new `src/lib/computerVision.test.ts` (4 cases), `docs/MAINTENANCE.md`, this file.
- Owner requests: none (issue #21 has no comments; no open claude/dev- PR).
- Verification: `npm ci --legacy-peer-deps` OK; `npm test` 130/130 passed; `npx tsc --noEmit` clean; `npm run build` NOT run locally (known offline Google Fonts failure) — relying on the Test workflow.
- Found but not changed: the 110 mean-luminance cutoff is a heuristic, untested on real dark scans (no fixtures); mixed-polarity pages are not handled. Other outstanding items unchanged.

### 2026-11-08 (Africa/Lagos) — branch claude/dev-2026-11-08
- Changed: `src/services/sessionDeletion.ts` (+test, 4 cases), `src/app/attendance/history/page.tsx` (#14), `docs/MAINTENANCE.md`, this file.
- Owner requests: none (issue #21 has no comments; no open claude/dev- PR).
- Verification: `npm ci --legacy-peer-deps` OK; `npm test` 126/126 passed; `npx tsc --noEmit` clean; `npm run build` NOT run locally (known offline Google Fonts failure) — relying on the Test workflow.
- Found but not changed: no storage policies in repo (see Outstanding); #38 awaits canonical version; #13/#2 need plans/owner decisions.

### 2026-11-07 (Africa/Lagos) — branch claude/dev-2026-11-07
- Changed: `src/components/Sidebar.tsx` (#34 Logout wired: signOut with try/catch, disabled while pending, full navigation to /login), `docs/MAINTENANCE.md`, this file.
- Owner requests: none (issue #21 has no comments; no open claude/dev- PR).
- Verification: `npm ci --legacy-peer-deps` OK; `npm test` 122/122 passed; `npx tsc --noEmit` clean; `npm run build` NOT run locally (known offline Google Fonts failure) — relying on the Test workflow. No unit test (DOM component; vitest env is node).
- Found but not changed: rest of #34 needs owner's implement-vs-remove decision; #38 awaits canonical version; #13/#2 history above.

### 2026-11-06 (Africa/Lagos) — branch claude/dev-2026-11-06
- Changed: `src/app/attendance/new/page.tsx`, `src/app/sessions/[id]/page.tsx`, `src/app/members/page.tsx` (#29 narrowed selects), `src/types/index.ts` (optional fields), `docs/MAINTENANCE.md`, this file.
- Side effect: `suggested_table` JSON stored for new sessions no longer embeds member phone/email.
- Owner requests: none (issue #21 has no comments; no open claude/dev- PR).
- Verification: `npm ci --legacy-peer-deps` OK; `npm test` 122/122 passed; `npx tsc --noEmit` clean; `npm run build` NOT run locally (known offline Google Fonts failure) — relying on the Test workflow.
- Found but not changed: #38 awaits owner's canonical version; #13/#2 need plans/owner tenancy decision.

### 2026-11-05 (Africa/Lagos) — branch claude/dev-2026-11-05
- Changed: `src/app/page.tsx` (#15 partial: parallel counts, narrowed recent-sessions select), `docs/MAINTENANCE.md` (#15 marker), this file.
- Owner requests: none (issue #21 has no comments; no open claude/dev- PR).
- Verification: `npm ci --legacy-peer-deps` OK; `npm test` 122/122 passed; `npx tsc --noEmit` clean; `npm run build` NOT run locally (known offline Google Fonts failure) — relying on the Test workflow.
- Found but not changed: history page selects `*` because it renders `suggested_table.length`; narrowing needs a schema/count change. #38 awaits owner's canonical version; #13 awaits tenancy decision.

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
