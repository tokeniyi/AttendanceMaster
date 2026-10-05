# AttendanceMaster — Maintenance & Development Backlog

> **This document is the source of truth for automated daily development runs.**
> It is updated on every task branch. Daily runs must re-read it *and* the code
> before choosing work — never trust a previous run's analysis.

- **Repository:** `tokeniyi/AttendanceMaster`
- **Description:** OCR-based attendance register marking (Next.js 15, Supabase, tesseract.js, Fuse.js)
- **Default branch:** `main` (protected — never pushed to directly)
- **Review baseline:** commit `1c8c401`
- **Last reviewed:** 2026-09-26

---

## 1. Architecture

### 1.1 Shape — everything is a client component

There is **no** `route.ts`, no server action, and no `error.tsx` / `loading.tsx` /
`not-found.tsx` anywhere under `src/app`. `src/app/template.tsx` is a `"use client"`
framer-motion wrapper applied to every route.

```
middleware.ts                 cookie-based auth redirect
src/app/layout.tsx            server component, wraps everything in <Sidebar/>
src/app/page.tsx              dashboard: counts + 5 recent sessions
src/app/login/page.tsx        supabase.auth.signInWithPassword
src/app/members/page.tsx      roster list, client-side filter, CSV import
src/app/attendance/new/page.tsx     upload → OCR → match → session insert
src/app/attendance/history/page.tsx session list, optimistic delete
src/app/sessions/[id]/page.tsx       the workspace (3-pane human-in-the-loop editor)
src/app/sessions/[id]/success/page.tsx  post-approval report + CSV export
src/lib/supabase.ts           anon-key client (Proxy wrapper)
src/lib/tableSegmenter.ts     projection-profile table grid detection
src/lib/computerVision.ts     binarize / dilate / erode / connectedComponents
src/lib/semanticAnalyzer.ts   row region + column type classification
src/lib/dataCorrector.ts      per-cell text normalization + row validation
src/lib/imageProcessor.ts     contrast/brightness/sharpen — DEAD
src/lib/uploadValidation.ts   MIME + 10 MB cap
src/OCR/ocrService.ts         tesseract.js orchestration (4-phase)
src/matching/matchEngine.ts   Fuse.js name matching
src/services/approval.ts      row filter — used ONLY by its own test
src/services/csvService.ts    Papa.parse/unparse
public/tesseract/*            8.0 MB of WASM core + worker, committed
database/schema.sql           6 tables, RLS, 2 SQL functions
```

### 1.2 End-to-end flow

1. **`attendance/new/page.tsx:22-30`** — fetches **all** `members` and **all** `corrections`
   (no `.limit()`), no error handling.
2. **`:32-139 processFile`** — `validateUpload(file)` → `performOCR(file, onProgress)`.
3. **`ocrService.performOCR:52-245`**
   - Phase 0: `detectTableGrid` → downscale to `MAX_DIM=1000`, binarize, dilate (2×20 / 20×2),
     horizontal + vertical projection profiles, `findBoundaries` → a `cells[row][col]` grid.
     Returns `null` if <2 boundaries on either axis.
   - No grid → `runWordCluster` (PSM 6, Y-clustering, gap-based column split).
   - Phase 1: `min(4, hardwareConcurrency-1)` scheduler workers + 1 fallback worker (PSM 8),
     all pointed at `/tesseract/*`. OCRs the first rows, classifies them, infers column types,
     then OCRs remaining cells with per-column numeric filtering.
   - Phase 3/4: per-row `validateRow`; rows failing schema or `avgConf < 75` re-recognize cells
     below conf 70 with the fallback worker if it scores higher.
   - `finally` terminates both workers (leak fix from `b065302`).
4. **`:61-76`** — `matchMembers(...)`, then zips OCR metadata onto results by index. **(Bug #5)**
5. **`:82-121`** — `auth.getUser()`, compress to ≤1600px JPEG q0.75, upload to `attendance-scans`
   at `${user.id}/${uuid}.jpg`, insert a `sessions` row with `owner_id`, `raw_ocr_data`,
   `suggested_table`, `status:'pending'`, and `image_url` = **storage key, not URL** (PII fix `f39e218`).
6. **`:126`** — `window.location.href = /sessions/${id}`.
7. **`sessions/[id]/page.tsx:72-98`** — loads session + all members, mints a 300 s signed URL
   for the source image, seeds undo history from `suggested_table`.
8. **Editing** — every mutation goes through `pushHistory` (`:126-136`) with a `useTransition`.
9. **Approval** — `saveState('approved'):222-240` calls `supabase.rpc('approve_session', …)`,
   which in `schema.sql:79-93` writes `final_table`, sets `status='approved'`, and upserts one
   `attendance` row per element of `p_rows` on `ON CONFLICT (session_id, member_id)`.
10. **Drafts are never persisted.** `saveState('refining')` is never called from the UI, so
    in-progress work survives only in memory.

### 1.3 `middleware.ts`

Thin auth redirect: `createServerClient` with cookie `getAll`/`setAll`, `auth.getUser()` on
every request, redirect to `/login` if no user, to `/` if an authenticated user hits `/login`.
Matcher excludes only `_next/static`, `_next/image`, `favicon.ico`.
**It is not the authorization boundary — RLS is.** See backlog #2.

### 1.4 `database/schema.sql`

6 tables, indexes, 2 plpgsql functions (`upsert_correction`, `approve_session`, both
`SECURITY INVOKER`), RLS on all 6, 6 policies: `USING (true)` for `members` /
`corrections` / `import_mappings`, owner-scoped for `sessions`, owner-scoped `EXISTS` for
`attendance` and `session_versions`. A solid foundation with two structural problems (#3, #13).

### 1.5 `public/tesseract`

8.0 MB of committed WASM (`tesseract-core.wasm` 3.5 MB, `tesseract-core.wasm.js` 4.7 MB,
`worker.min.js` 124 KB) at hardcoded absolute paths. **No `.traineddata` is committed and
`langPath` is never set**, so tesseract.js v5 falls back to its remote tessdata CDN — the
first OCR requires an external network fetch. The README's offline/privacy claim is
therefore not true. *(High-confidence inference from tesseract.js defaults; exact resolved
URL UNVERIFIED — `node_modules` not installed during review.)*

---

## 2. Headline state

- **6 P0 bugs**, four of which are **silent data corruption** into the `attendance` table.
- The most severe is a **substring match against a UUID** (`matchEngine.ts:34`) that returns
  `confidence: 1.0, status: 'exact'` for arbitrary OCR fragments — and is presented to the
  operator as maximally trustworthy.
- **Two halves of the app use incompatible auth strategies** (cookies vs `localStorage`),
  with no bridge — the app is expected to be unusable in any deployment where middleware runs.
- **Four shipped-looking features are permanently dead** because three semantic fields are
  dropped before persistence (the "Approve All Data" button approves *zero rows*).
- **Security:** `members` and `corrections` are readable *and writable* by every authenticated
  user, exposing `full_name`, `email`, `phone`, `department` across tenants.
- **Testing:** one test file for the whole app, and it tests a component that never runs in
  production (`src/services/approval.ts` has no production caller).

---

## 3. Backlog

### P0 — Critical bugs (ship-blockers; silent data corruption)

**1. `m.id.toLowerCase().includes(lowerName)` matches arbitrary OCR fragments as a 1.0-confidence exact match**
- `src/matching/matchEngine.ts:34` (and the identical copy being deleted at HEAD's old lines 59-73)
- **Verified by execution.** `member.id` is a UUID (`schema.sql:3`). A one- or two-character
  OCR artifact — `"a"`, `"d"`, `"0"`, `"-"` — is a *substring* of nearly every UUID, so
  `members.find` returns the first roster member whose UUID contains it, at
  `confidence: 1.0, status: 'exact'`. Single letters and punctuation are exactly what OCR of
  a noisy table cell produces.
- **Impact:** flows into `suggested_table` → `approve_session` → a wrong-person `attendance`
  row, displayed to the operator as maximally confident.
- **Fix:** anchor the ID check. Matching a substring against a UUID has no correct form.
  If ID matching is genuinely wanted it needs a *separate* numeric field on `members` matched
  with `^`/`$`. Interim: gate behind `lowerName.length >= 6 && /^\d+$/.test(lowerName)`, or
  delete the clause. Add the regression tests from #20.

**2. Two incompatible auth strategies — `middleware.ts` vs `src/lib/supabase.ts`**
- `middleware.ts:6-17`, `src/lib/supabase.ts:12`, `src/app/login/page.tsx:26-36`
- `middleware.ts` builds a `@supabase/ssr` client reading **cookies only**. `supabase.ts:12`
  builds a plain `createClient(url, anonKey)` with **no `storage` option** → session lives in
  **`localStorage`**. There is **no `onAuthStateChange` cookie bridge anywhere** (verified by grep).
- **Impact:** after login the token is in `localStorage`, never a cookie, so `getUser()` in
  middleware cannot see the user → redirect back to `/login`. The storage mismatch is verified
  by code; **the exact observed symptom is UNVERIFIED** (could not run the app). A local
  Supabase project with cookies left by an older client could mask it.
- **Fix (a) — smaller, keeps SSR:** make `src/lib/supabase.ts` return `createBrowserClient`
  from `@supabase/ssr` and add an `onAuthStateChange` subscriber that writes cookies.
  Also wrap `getUser()` in try/catch and add `|tesseract/|\..*` to the matcher (see #6).

**3. `approve_session` inserts attendance rows with `member_id = NULL` for every unmatched line**
- `database/schema.sql:87-91`
- `row->'suggestedMember' IS NOT NULL` is **true for a JSON `null`** (a value, not SQL NULL),
  so `status:'none'` rows pass the filter, `->>'id'` evaluates to SQL NULL, and
  `attendance.member_id` is nullable (`schema.sql:16`). The unique index is NULL-distinct,
  so one junk row accumulates per unmatched line.
- **Fix:** `WHERE jsonb_typeof(row->'suggestedMember') = 'object' AND row->'suggestedMember'->>'id' IS NOT NULL`.
  Then `ALTER TABLE attendance ALTER COLUMN member_id SET NOT NULL` to make the class of
  bug unrepresentable.

**4. `flagRow` and the review gate are advisory — flagged and never-reviewed rows are recorded as present**
- `database/schema.sql:86-91`, `src/app/sessions/[id]/page.tsx:157-166, 253-254, 288, 366`
- The SQL filter never consults `row->>'status'`. The finalize button has no gate on
  `approvedCount` / `progressPct` (computed at `:253-254`, displayed but never enforced).
  `matchEngine.ts:60-69` accepts `fuse.search(...)[0]` with **no confidence floor** — the
  configured `threshold: 0.35` yields `confidence: 0.65`, and a weak match just below
  threshold is indistinguishable to `approve_session` from a confirmed one.
- **Impact:** a row the operator explicitly flagged as wrong — and every row they never
  looked at — is written to `attendance` as `present = TRUE`.
- **Fix:** extend the SQL `WHERE` to exclude `status = 'flagged'`; require `status='approved'`
  or add an explicit "approve all unflagged" confirm step. Add a `minConfidence` constant to
  `matchEngine.ts` and return `status:'none'` below it.

**5. `region` / `explanation` / `semanticConfidence` are dropped before persistence, silently killing four features**
- Producer `src/app/attendance/new/page.tsx:67-76`; consumers at
  `src/app/sessions/[id]/page.tsx:195, 213, 322-330, 366, 441-442, 521-539`
- The `.map` copies 7 named fields and omits the three semantic fields that
  `analyseDocument` produces (`ocrService.ts:240-241`) and that `MatchResult` declares
  (`types/index.ts:58,60`).
- **Impact:** "Approve All Data" filters `r.region === 'data'` and therefore approves
  **zero rows** — the button is a no-op. The AI-reasoning panel never renders, the debug
  overlay, region row-tinting, and title/footer CSV exclusion are all permanently dead.
  The features *look* shipped.
- **Fix:** spread the OCR line instead of enumerating fields:
  `{ ...res, ...extractedLines[i], ocrName: res.ocrName, status: res.status, suggestedMember: res.suggestedMember, confidence: res.confidence }`.
  Then delete the seven `(row as any)` casts in the consumer — the types already declare these fields.

**6. `validateUpload` throws outside the caller's `try` — unhandled rejection, no user feedback**
- Caller `src/app/attendance/new/page.tsx:32-40`; `handleDrop:150`
- A non-image MIME type or a >10 MB file throws at `:34`, *before* the `try` at `:40`, from an
  async function called without `.catch()` at `:143`/`:150`. Nothing is shown; the file is
  silently rejected. `handleDrop` discards non-images with no message at all.
- **Fix:** make `validateUpload` **return** `string | null` (a message) instead of throwing,
  and have `processFile` set a `fileError` state rendered inline. Reject non-images in
  `handleDrop` with the same message.

### P1 — Significant

**7. ~~`validateRow` corrections are discarded on exactly the rows that needed them~~ — DONE 2026-10-05 (`fix/ocr-row-corrections-discarded`)**
- `src/OCR/ocrService.ts:192-221` — **an inverted condition**
- `finalCols = validation.correctedColumns` was assigned in the `else` at `:220` and inside
  `if (healed)` at `:217`, but **not** when the low-confidence branch was taken and nothing
  healed. So every per-column `correctCellText` normalization (name title-casing, numeric
  letter→digit repair, status mapping — `dataCorrector.ts:139-142`) was applied **only to rows
  that already had high confidence**, which are precisely the rows that did not need it.
- **Fix applied:** extracted the Phase 3→Phase 4 decision into an exported pure function
  `finalizeRowColumns()` in `src/lib/dataCorrector.ts:158-199`, called from `ocrService.ts:184`.
  Corrections now apply to **every** row. The Phase 4 loop writes healed text into a separate
  `healedCols` array and re-runs `finalizeRowColumns` on it, so healed values are corrected too.
  `MIN_ROW_CONFIDENCE = 75` is now a named export instead of a literal in two places.
- **Why extraction was necessary:** the buggy logic was inline in a ~200-line function
  requiring 5 tesseract workers + a canvas + WASM, so it was unreachable from a unit test. The
  control-flow *decision* is now testable with no OCR infrastructure at all.
- **Tests:** `src/lib/dataCorrector.test.ts` — 10 tests. 3 pin the bug (low-confidence-unhealed,
  schema-invalid-unhealed, numeric letter-confusion), 7 pin preserved behaviour (threshold
  boundary at exactly 75, `needsFallback` in both directions, healed-text recomputation, and the
  `healedColumns === null` sentinel vs empty-array distinction). **Mutation-verified:**
  reintroducing the old branch fails exactly the 3 bug tests and passes all 7 guards.
- **Newly discovered while testing:** `validateRow([], n, …)` pads to `n` empty cells rather
  than returning `[]`, so a falsy-but-present `healedColumns` must be distinguished with
  `=== null`, not truthiness. Pinned by a test.

**8. Roster/corrections fetch race + swallowed errors**
- `src/app/attendance/new/page.tsx:22-30, 61-65`
- `processFile` reads `members`/`corrections` from the render closure and nothing blocks
  upload until the fetch resolves → a fast user matches against `[]` → every row
  `status:'none'` → #3 writes NULL-member rows. The fetch also discards `error` entirely,
  so a failed query looks like an empty roster.
- **Fix:** load the roster inside the same `try` immediately before `matchMembers` (or track
  a `rosterLoaded` promise), surface `error` in the UI, disable the dropzone until resolved.

**9. Unanchored `/no\.?/` classifies ordinary headers as `serial`, and `normalizeSerial` then destroys their contents**
- `src/lib/semanticAnalyzer.ts:217` (fork at `src/app/sessions/[id]/page.tsx:60`); consumer `src/lib/dataCorrector.ts:54-55, 97-100`
- **Verified by execution:** `Notes`, `Nomination`, `Notional` → `serial`. A `serial` column is
  routed to `normalizeSerial`, which strips every non-digit. Data-destroying, silent, and it
  happens inside the pipeline before the operator ever sees the row.
- **Fix:** `/\b(?:sr|no|serial)\b\.?|^#/i`. Add the regression cases from #21.

**10. Two forked column-type inference implementations that already disagree**
- `src/lib/semanticAnalyzer.ts:214-238` vs `src/app/sessions/[id]/page.tsx:53-70`
- **Verified by execution:** the page's copy labels `Present`/`Absent`/`LWP` as `numeric` because
  it tests that regex (`:64`) *before* `/status/`, and lacks `date`/`text` entirely. The page then
  feeds those types into `COLUMN_TYPE_CONFIG` imported *from* the analyzer, so the UI badges
  contradict the analyzer's own schema.
- **Fix:** export `inferType` (or `inferColumnSchema`) and call it from the page.

**11. Approval-row filtering is implemented twice; the tested one never runs**
- `src/services/approval.ts:3-5` (no production caller) vs `database/schema.sql:90`
  (the real implementation, untested, carrying bug #3)
- **Fix:** once #3 and #4 are fixed, move the row-selection contract entirely into the SQL
  function (it is the enforcement point) and test it there — or delete `approval.ts` and its test.

**12. No regression test for the exact-over-correction precedence that commit `5f52560` introduced**
- `src/matching/matchEngine.test.ts:7-11`
- The test named *"prefers learned corrections"* now describes the **opposite** of the
  implemented contract, and passes only because `"Adaa"` has no exact match. The behaviour the
  most recent feature commit exists to guarantee is untested.
- **Fix:** add a case where a string **both** exactly matches a member **and** has a learned
  correction, asserting `status === 'exact'`. Rename the existing case to what it actually pins.

**13. `members` and `corrections` are readable and writable by every authenticated user (PII exposure)**
- `database/schema.sql:109-110` — `USING (true) WITH CHECK (true)` on `members`
- Exposes `full_name`, `email`, `phone`, `department` (`schema.sql:4-8`) to any signed-up
  user, across tenants, and permits `DELETE`/`UPDATE`. `corrections` leaks the
  OCR-garbled-string → member-ID mapping. **The sharpest security finding in the repo.**
- **Fix:** introduce an `organizations`/`tenants` table and scope `members`, `corrections`,
  `attendance`, `sessions` to it, or — if single-tenant is the intent — say so explicitly in
  the schema and README and drop the multi-tenant framing from the policies.

**14. Deleted sessions leave PII scans orphaned in storage forever**
- `src/app/attendance/history/page.tsx:44-51`, `database/schema.sql:61`
- The DB row cascades; the `attendance-scans/{user_id}/{uuid}.jpg` object does not. Once the
  session row is gone the object is unreachable but retained indefinitely, outside RLS's
  reach. **That is the retention policy for photographed attendance registers.**
- **Fix:** a `BEFORE DELETE ON sessions` trigger that removes the storage object
  (`storage.foldername(name)[1] = owner_id::text`), or delete the object in the same request.

**15. Unbounded queries, two of which pull full OCR JSONB per row**
- `src/app/attendance/history/page.tsx:35-38` (no `.limit()`, `select('*')` → `raw_ocr_data` +
  `suggested_table` for every session), `src/app/page.tsx:29-50` (three sequential count
  round-trips), `src/app/attendance/new/page.tsx:24-25`, `src/app/sessions/[id]/page.tsx:77`,
  `src/app/members/page.tsx:26`
- **Fix:** narrow the selects, add `.limit()` + pagination, `Promise.all` the dashboard counts.

**16. 5 tesseract workers re-instantiated (with multi-MB WASM cores) on every upload**
- `src/OCR/ocrService.ts:76-85, 243`
- Correctly terminated — which is exactly the problem: nothing is reused. Every upload
  re-creates up to 5 workers, each loading the 3.5 MB core, plus a per-worker language-model
  fetch (§1.5).
- **Fix:** a module-level worker pool with ref-counting; create on first use, terminate on
  idle timeout. Commit `eng.traineddata` to `public/tesseract/` and set `langPath:'/tesseract'`
  so the app works fully offline — which also makes the README's privacy claim true.

**17. `runWordCluster` leaks its Web Worker when recognition throws**
- `src/OCR/ocrService.ts:250-271` — the grid path is protected by `try/finally` (`:242-244`,
  from `b065302`) but this path terminates only on the success path (`:270`). A throw from
  `worker.recognize` orphans a worker and its WASM memory for the tab's lifetime.
- **Fix:** wrap `:267-270` in `try { … } finally { await worker.terminate(); }`.

**18. Object URLs are never revoked in `loadImage`**
- `src/lib/tableSegmenter.ts:197-208`, `src/lib/imageProcessor.ts:80-91`
- `URL.createObjectURL` with no revoke, and `img.onload = () => resolve(img)` leaves no handle.
  `performOCR` calls it at least twice per run. With the 10 MB cap, repeated or failed uploads
  pin tens of MB.
- **Fix:** revoke in an `onload`/`onerror` continuation after `drawImage` has consumed it.

**19. Object URL revoked while still displayed**
- `src/app/attendance/new/page.tsx:42-43` sets `image` to the object URL; `:137` revokes it in
  `finally`. The preview `<img src={image}>` at `:227` then renders a broken image for the rest
  of the page's life, including the "Image loaded" branch at `:231-235` shown after an error.

**20. `NaN` analytics on an empty table**
- `src/app/sessions/[id]/success/page.tsx:158, 161` — `0/0` when `finalTable.length === 0`.
  **Verified by execution:** `dataQualityIndex = NaN`, and `width: 'NaN%'` is invalid CSS.
  `final_table` is nullable in practice (e.g. navigating directly to a `pending` session).
- **Fix:** guard the division and early-return an empty state.

**21. Keyboard handler closes over stale `history`**
- `src/app/sessions/[id]/page.tsx:113-124` — undo/redo state read from a stale closure.

**22. Inverted (dark-background) images are unsupported but silently produce garbage**
- `src/lib/tableSegmenter.ts:57, 118`, `src/OCR/ocrService.ts:102, 200`
- The comment at `:118` claims inversion is handled inside `binarize`, but `binarize` only
  inverts when passed `isInverted` and `detectTableGrid` calls it bare. There is no polarity
  detection anywhere. Dark-background registers binarize as solid black.
- **Fix:** implement real polarity detection, or surface a clear "dark-background scans are not
  supported" error rather than emitting a garbage grid.

**23. `login/page.tsx:26` has no try/catch** — `getSupabaseClient()` throws when env vars are
missing, through the Proxy at `supabase.ts:17-21` on first property access. The throw skips the
`if (error)` branch, so `isLoading` stays `true` forever — a permanently disabled button with no
message. Same class of problem for every unguarded `supabase.*` call.

**24. Worker count is not adaptive in a useful way** — `ocrService.ts:74` yields 1 worker on a
2-core machine and 4 on anything ≥5-core, but each is created sequentially and loads the 3.5 MB
core before the first cell is recognized. Combined with #16, the first upload is disproportionately slow.

**25. Yield to the event loop between cell extractions** — `ocrService.ts:141, 173`. All N
`extractCellImage` calls (canvas + 3× upscale + `getImageData` + threshold + union-find +
`toDataURL`) run synchronously in one burst before the first `await`, so the progress UI does
not paint. Add `if (done % 32 === 0) await new Promise(r => setTimeout(r, 0))`.

### P2 — Improvement

**26. Add a `typecheck` script and wire CI** — `package.json:5-11`. `tsc --noEmit` is only
reachable via `next build`; nothing runs `lint`, `typecheck`, or `test` in CI. This is what
stops the §10 drift from recurring.

**27. Replace `schema.sql` with versioned migrations** — `ALTER TABLE … IF NOT EXISTS` /
`DROP POLICY IF EXISTS` gives no version tracking, no rollback, and no way to know what is
deployed. Adopt `supabase/migrations/` with numbered timestamped files.

**28. Test the SQL layer** — add a Supabase local test (`supabase test db`) covering
`approve_session` and `upsert_correction`. The row-selection contract is the enforcement
point for #3 and #4 and currently has zero coverage.

**29. Narrow the roster selects** — the members fetches repeat three times across the app and
include never-rendered PII columns.

**30. Memoise the success-page analytics** — `success/page.tsx:158-189` performs 7 inline
`filter` traversals per render; extract to a single `useMemo`.

### P3 — Nice-to-have

**31. Rewrite `README.md`** — correct the table list, drop the shadcn reference, correct the
export instructions, either implement or delete the correction-learning claim, soften the privacy
claim until `.traineddata` is committed, and add an architecture section describing the 4-phase
pipeline, the storage-key decision, and the RLS ownership model.

**32. Replace hardcoded environment-specific values with config** — `ocrService.ts:78, 84, 256-257`
(`/tesseract/...`), `attendance/new/page.tsx:106` and `sessions/[id]/page.tsx:82`
(`attendance-scans`).

**33. Fix layout nesting in the workspace** — `sessions/[id]/page.tsx:257` uses `h-screen`
inside `layout.tsx:24`'s `p-8 overflow-y-auto h-screen` `<main>` → nested scroll containers.

**34. Wire up or remove the non-functional controls** — "Add Member" (`members/page.tsx:75-78`),
row trash/edit (`:111-116`), "Filter" (`attendance/history/page.tsx:106-108`), "Logout"
(`Sidebar.tsx:79-82` — no `signOut` exists), and the hardcoded `href="#"` workspace list
(`Sidebar.tsx:66-76`).

**35. Implement or remove the "Google Sheets" / "PDF" buttons** — `success/page.tsx:106-126` are
`alert()` / `window.print()` stubs. The workspace's clipboard-TSV export (`:208-218`) is the real
feature.

**36. Delete the dead `src/lib/imageProcessor.ts`** — unused; superseded by `computerVision.ts`.

**37. Consolidate the magic numbers behind documented config** — `threshold: 0.35`, `Y_TOL = 14`,
`MAX_DIM = 1000`, the `140` binarize threshold, the `70`/`75` confidence gates, `0.005`/`0.015`
projection thresholds, `max = 1600`. Each silently changes OCR quality; none is configurable.

**38. Align version strings** — `package.json:3` (`0.1.0`) vs `Sidebar.tsx:33` (`v1.1.0`).

---

## 4. Testing

- **One test file** for the entire application: `src/matching/matchEngine.test.ts` (vitest).
- It covers the one module that is pure logic and easy to break — a good instinct — but the
  surface it guards is small next to what is untested.
- **Untested:** the entire OCR pipeline (`ocrService`, `tableSegmenter`, `computerVision`),
  all Supabase access, all routes and components, and — critically —
  `database/schema.sql`, which is the actual enforcement point for attendance
  writes. *(`dataCorrector` gained coverage 2026-10-05 via #7 — 10 tests on the row
  finalization contract. `semanticAnalyzer` tests exist on PR #9, not yet on `main`.)*
- **The one tested approval component never runs in production** (#11), so the approval path has
  effectively **zero** coverage of the code that matters.
- **Highest-value new tests:** (a) the UUID-substring regression (#1), (b) the
  exact-over-correction precedence (#12), and (c) SQL tests for `approve_session` (#28).
  *(c) for the `serial` header misclassification (#9) was written on PR #9 and is still open.*

---

## 5. Documentation gaps

`README.md` is thin and contains several claims the code does not support: the table list, a
shadcn reference, the correction-learning behaviour, the export instructions, and an
offline/privacy claim that fails because no `.traineddata` is committed (§1.5). See #31.

---

## 6. Daily run log

| Date | Branch | Task | PR | Result |
|---|---|---|---|---|
| 2026-09-26 | `chore/maintenance-doc` | Initial review + this document | — | Baseline established, 0 of 38 items closed |
| 2026-10-05 | `fix/ocr-row-corrections-discarded` | P1 **#7** — stop discarding `validateRow` corrections on low-confidence rows | #10 | Tests 13/13 (was 3), lint 0 errors / 4 warnings, tsc clean. **#7 closed.** Mutation-verified: reintroducing the old branch fails exactly the 3 bug tests. Chose #7 over higher-numbered P1 items because it is the only unclaimed P1 that silently mutates every OCR row. |

**Remaining backlog:** 6 × P0, 18 × P1, 5 × P2, 8 × P3 = **37 open items**.

> ⚠️ **The real bottleneck is review throughput, not the backlog.** As of 2026-10-05 there are
> **9 open, unmerged PRs** (#2–#10) and **zero P0 fixes have landed** — only the initial doc PR
> merged. All 6 P0 items sit behind PRs that nobody has merged, so the four silent
> data-corruption bugs are still live in `main`. **Writing new P1 fixes is now lower value than
> merging what exists.** A future run should stop adding to the queue unless every open PR is
> merged or explicitly rejected.

---

## 7. Note on the uncommitted working-tree change

At review time the working tree carried one uncommitted modification to
`src/matching/matchEngine.ts` (16 lines removed, 1 added).

> **2026-10-05 note.** The 2026-10-04 run log entry and the "DONE" markers for #9 exist **only on
> PR #9's branch**, never on `main`. A run that checks out `main` sees #9 as still open — which is
> correct, because PR #9 is still unmerged. Do not carry those markers forward by hand; they
> reappear when the PR merges. For the same reason, `src/lib/semanticAnalyzer.test.ts` is
> **not tracked on `main`** (it only exists inside PR #9's working tree), and PR #9 will conflict
> with this branch's `docs/MAINTENANCE.md` edits at the §6 run log and the #7 entry.

**This is a safe de-duplication, not a regression.** Commit `5f52560` ("prioritize exact matches
over corrections") already introduced an identical step-0 exact-match block at lines 30-43, which
runs *before* the correction lookup — making the deleted block (old lines 59-73) unreachable dead
code. The genuine defect is `m.id.toLowerCase().includes(lowerName)` at line 34, which survives
in the retained block and is backlog item **#1**.

**Still requires a decision:** whether to commit this de-duplication or discard it. It is
untracked work sitting in the working tree, and the daily cron job runs against this same
checkout — so it must be resolved before automated runs begin, or the job will operate on a
dirty tree.
