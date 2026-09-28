# AttendanceMaster — Maintenance & Development Backlog

> **This document is the source of truth for automated daily development runs.**
> It is updated on every task branch. Daily runs must re-read it *and* the code
> before choosing work — never trust a previous run's analysis.

- **Repository:** `tokeniyi/AttendanceMaster`
- **Description:** OCR-based attendance register marking (Next.js 15, Supabase, tesseract.js, Fuse.js)
- **Default branch:** `main` (protected — never pushed to directly)
- **Review baseline:** commit `1c8c401`
- **Last reviewed:** 2026-09-28

> **This document lives on an unmerged branch.** It was authored on
> `chore/maintenance-doc` and carried onto `fix/approve-session-null-member-rows`; neither
> is merged, so `docs/MAINTENANCE.md` does **not** exist on `main`. Every branch that
> updates the backlog must therefore import it, and whichever doc-bearing PR merges first
> will conflict with the others. **Merging either of those PRs first is the cheapest way to
> stop this recurring** (see §9).

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

Cookie-only auth guard: `createServerClient` with cookie `getAll`/`setAll`, `auth.getUser()`
on every request, redirect to `/login` if no user, to `/` if an authenticated user hits
`/login`. **It is not the authorization boundary — RLS is.** See backlog #2.

**Two behaviours worth knowing (both fixed 2026-09-28):**
- `getUser()` returns a **network failure as an `error`, not a throw**, so the session cookie
  and the Auth server's reachability are distinct states. The guard now **fails open** on a
  retryable fetch error (an Auth outage must not log out the whole user base) and only
  redirects when the session is genuinely missing or invalid. It also returns the response
  unchanged when the Supabase env vars are unset, instead of throwing on every route.
- The matcher excludes `_next/static`, `_next/image`, `favicon.ico`, `tesseract/` and static
  asset extensions, so the per-request Auth round-trip is not paid for static assets — in
  particular the multi-MB tesseract WASM in `public/tesseract/`.

**The browser client must persist to cookies for this to work at all.** That is the invariant
`src/lib/supabase.ts` now upholds via `createBrowserClient`; see #2.

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

- **4 P0 bugs**, two of which are **silent data corruption** into the `attendance` table.
- The most severe remaining is a **substring match against a UUID** (`matchEngine.ts:34`)
  that returns `confidence: 1.0, status: 'exact'` for arbitrary OCR fragments — and is
  presented to the operator as maximally trustworthy.
- **Auth is now coherent** (#2 closed 2026-09-28): the browser client persists to
  `document.cookie`, which is what the middleware reads.
- **Four shipped-looking features are permanently dead** because three semantic fields are
  dropped before persistence (the "Approve All Data" button approves *zero rows*).
- **Security:** `members` and `corrections` are readable *and writable* by every authenticated
  user, exposing `full_name`, `email`, `phone`, `department` across tenants.
- **Testing:** four test files. The SQL approval path now has real coverage, and the auth
  boundary is now covered; the OCR pipeline and all UI still have none.

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

**2. ~~Two incompatible auth strategies — `middleware.ts` vs `src/lib/supabase.ts`~~ — **CLOSED 2026-09-28**
- **Fixed** on branch `fix/supabase-cookie-session-matches-middleware`
  (`src/lib/supabase.ts`, `middleware.ts`, plus two new test files).
- **The bug, confirmed by running it:** after a successful `signInWithPassword`, the session
  was written to `localStorage` under `sb-<project-ref>-auth-token` and `document.cookie`
  was **empty**. The cookie-only `createServerClient` in `middleware.ts` therefore resolved
  no user on any request, and every authenticated page redirected back to `/login`.
- **The fix:** `src/lib/supabase.ts` now returns `createBrowserClient` from `@supabase/ssr`
  (already a dependency — it was added for the middleware), which persists to
  `document.cookie` under the same storage key the server client reads, so the two halves
  agree. An `isBrowser()` guard keeps a cookie-less fallback for server render and
  pre-render, where `document.cookie` does not exist and `@supabase/ssr`'s browser storage
  would throw.
- **Verified end to end at the library boundary:** a session written by the real
  `getSupabaseClient()` is read back by a real `createServerClient` built exactly as
  `middleware.ts` builds it, and `getUser()` returns the user instead of null.
- **Two guards added to `middleware.ts` alongside it:**
  - `getUser()` reports failure as a *returned* `error`, not a throw, so the old
    `const { data: { user } } = ...` destructuring silently treated a transient network
    failure as "signed out" and bounced every user to `/login`. The middleware now
    distinguishes a retryable fetch error (fail **open** — an outage must not log everyone
    out) from a genuinely missing or invalid session (redirect), and no longer 500s when
    the Supabase env vars are unset.
  - The matcher excluded only `_next/static`, `_next/image` and `favicon.ico`, so the auth
    guard ran a round-trip to the Auth server for every tesseract WASM asset in
    `public/tesseract/`. Added `tesseract/` and static asset extensions.
- **Tests:** `src/lib/supabase.test.ts` (6) and `src/lib/middleware.test.ts` (6), run
  against the real client constructors and the real middleware with a stubbed Auth server —
  no jsdom, no new dependency. **The key test was confirmed to FAIL against the unfixed
  module** (`expected '' to contain 'sb-probe-project-auth-token='`), so it is a genuine
  regression test rather than a restatement of the fix.
- **Not verified:** no user-facing symptom was observed in a live browser (the app cannot
  be run here), so the fix is proven at the library boundary, not end to end in a real
  signed-in session. Worth a manual login smoke test after merge.
- **Residual, not fixed:** `src/app/login/page.tsx:26` still has no try/catch around
  `getSupabaseClient()` and `signInWithPassword` — see #23. That is a separate defect and
  was left alone.

**3. ~~`approve_session` inserts attendance rows with `member_id = NULL` for every unmatched line~~ — **CLOSED 2026-09-27**
- **Fixed** in `database/schema.sql:86-115` on branch `fix/approve-session-null-member-rows`
  (together with #4, same function, same `WHERE` clause, same corruption class).
- `row->'suggestedMember' IS NOT NULL` is **true for a JSON `null`** (a value, not SQL NULL),
  so `status:'none'` rows passed the filter, `->>'id'` evaluated to SQL NULL, and
  `attendance.member_id` is nullable (`schema.sql:16`). The unique index is NULL-distinct, so
  one junk row accumulated per unmatched line on *every* approval.
- **New `WHERE`:** `jsonb_typeof(row->'suggestedMember') = 'object'` plus
  `row->'suggestedMember'->>'id' IS NOT NULL` plus a UUID-shape regex, which also makes the
  `::UUID` cast total — previously one malformed client-supplied id aborted the whole approval
  transaction and lost the legitimate rows with it.
- **Tests:** `src/services/approveSession.test.ts` — 9 cases executing the real function body
  against a real Postgres (PGlite) with the actual schema loaded from disk.
- **The `ALTER TABLE attendance ALTER COLUMN member_id SET NOT NULL` hardening from the doc was
  deliberately NOT done.** See §8.

**4. ~~`flagRow` and the review gate are advisory — flagged and never-reviewed rows are recorded as present~~ — **PARTIALLY CLOSED 2026-09-27**
- **SQL half closed:** `approve_session` now excludes `row->>'status' = 'flagged'`
  (`database/schema.sql:109`). A flagged row can still carry a valid `suggestedMember`
  (the OCR text was wrong, the member is still attached), so excluding by *absence of a member*
  would not have caught it — the flag itself has to be honoured. Covered by a test.
- **STILL OPEN — the `matchEngine.ts` half, deliberately not done this run:** a `minConfidence`
  floor so a weak match just below `threshold: 0.35` stops being indistinguishable from a
  confirmed one. `src/matching/matchEngine.ts` was deliberately left untouched: it is the file
  carrying the pre-existing uncommitted working-tree change (§7), and committing it would have
  absorbed someone else's undecided work into this branch. Tracked below as its own item.
- **STILL OPEN — the UI half:** the finalize button still has no gate on `approvedCount` /
  `progressPct` (computed at `sessions/[id]/page.tsx:253-254`, displayed but never enforced).
  `saveState('approved')` at `:227` still passes the entire `tableData` to the RPC. Rows that
  were never looked at are now still recorded, provided they are not `flagged`. Closing this
  needs a product decision (block on zero approvals? confirm "approve all unflagged"?), not
  just a code change, so it is deliberately left for a human.

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

**7. `validateRow` corrections are discarded on exactly the rows that needed them**
- `src/OCR/ocrService.ts:192-221` — **an inverted condition**
- `finalCols = validation.correctedColumns` is assigned in the `else` at `:220` and inside
  `if (healed)` at `:217`, but **not** when the low-confidence branch is taken and nothing
  healed. So every per-column `correctCellText` normalization (name title-casing, numeric
  letter→digit repair, status mapping — `dataCorrector.ts:139-142`) is applied **only to rows
  that already had high confidence**, which are precisely the rows that did not need it.
- **Fix:** assign `finalCols = validation.correctedColumns` unconditionally after the fallback
  loop, then overwrite with the healed result if `healed`. Remove the `else`.

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

- **Four test files** (as of 2026-09-28), 15 tests:
  - `src/matching/matchEngine.test.ts` (2) — the matcher.
  - `src/services/approval.test.ts` (1) — the dead approval filter (#11).
  - `src/services/approveSession.test.ts` (9, on the 2026-09-27 branch) — the real
    `approve_session` function against PGlite with the real schema from disk. **This is the
    highest-value coverage in the repo**, because that function is the enforcement point for
    every write to `attendance`.
  - `src/lib/supabase.test.ts` (6) + `src/lib/middleware.test.ts` (6) — the auth boundary, run
    against the real client constructors and the real middleware with a stubbed Auth server.
    No jsdom, no new dependency.
- **Untested:** the entire OCR pipeline (`ocrService`, `tableSegmenter`, `computerVision`,
  `dataCorrector`, `semanticAnalyzer`), all Supabase data access, and all routes and
  components.
- **Technique worth copying:** the auth tests stand up a minimal `document.cookie` /
  `localStorage` stand-in instead of pulling in jsdom, because the libraries only check
  `typeof window`/`typeof document` and touch `document.cookie`. That keeps the suite on the
  existing `environment: "node"` config and adds zero dependencies.
- **Also worth copying: verifying a regression test actually fails against the unfixed
  code.** For #2 the new test was run against the reverted `src/lib/supabase.ts` and failed
  (`expected '' to contain 'sb-probe-project-token='`), which proves it guards the behaviour
  rather than restating the fix. A test that passes both before and after is decoration.
- **Highest-value new tests still missing:** (a) the UUID-substring regression (#1), (b) the
  exact-over-correction precedence (#12), (c) the `serial` header misclassification (#9).

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
| 2026-09-27 | `fix/approve-session-null-member-rows` | P0 #3 + SQL half of #4: `approve_session` row filter | [PR](../../pulls) *(opened — see §6)* | #3 closed, #4 half closed. 4 files. 9 new SQL tests + 2 pre-existing test files green. 38 → 37 closed |
| 2026-09-28 | `fix/supabase-cookie-session-matches-middleware` | P0 #2: browser session must be a cookie the middleware can read | [PR](../../pulls) *(opened — see §6)* | #2 closed. 4 files. 12 new tests, full suite 15/15 green. 37 → 36 closed |

**Remaining backlog:** 3 × P0 (from 4), 20 × P1, 5 × P2, 8 × P3 = **36 open items**.

**Highest-value next step, and it is no longer blocked:** P0 **#39** (the `MIN_CONFIDENCE`
floor in `matchEngine.ts`) was deferred on 2026-09-27 *only* to avoid absorbing the
uncommitted §7 working-tree change into that branch. That reasoning still holds — but note
that fixing #39 requires editing the very file carrying that change, so **#39 and #1 both
need the §7 decision resolved first.** See §7.

**Reprioritisation after this run (deliberate, not a full re-audit):** #1 (the UUID substring
match) remains the most severe open defect and is the only P0 that silently writes a
*wrong person's* attendance row. #5 (dropped semantic fields killing four shipped-looking
features) is the highest-value P0 in operator-visible terms. #6 and #23 are small, low-risk
UX-trust fixes that share the "unguarded throw leaves the UI stuck" class.

### Newly discovered 2026-09-27

**39. `matchEngine.ts` has no confidence floor — a weak fuzzy match is recorded as attendance**
- `src/matching/matchEngine.ts:60-69` — the `matchEngine.ts` half of old #4, split out so it can
  be fixed without touching the file that carries the uncommitted §7 change.
- `fuse.search(...)[0]` is accepted with no floor on the returned score. `threshold: 0.35` only
  decides whether a result is *returned*; a match at 0.36 and a match at 0.99 are equally
  accepted, and `approve_session` cannot tell them apart.
- **Fix:** add a `MIN_CONFIDENCE` constant and return `status: 'none'` below it, so a weak
  suggestion must be explicitly assigned by the operator rather than silently recorded as
  `present = TRUE`. **Blocked only by the §7 uncommitted change — clear it and this becomes the
  next P0.**

**40. Approval has no gate on review progress — never-reviewed rows are still recorded as present**
- `src/app/sessions/[id]/page.tsx:227, 253-254, 288` — the UI half of old #4.
- `approvedCount` / `progressPct` are computed and displayed but never enforced; the finalize
  button sends the whole `tableData` to `approve_session`. After this run's fix, unflagged-but-
  never-reviewed rows are still written as present.
- **Fix:** require `status === 'approved'`, or add an explicit "approve all unflagged" confirm
  step. **Needs a product decision before code** — do not pick unilaterally.

**41. Node/npm install scripts are blocked on this machine, leaving `node_modules/.bin` incomplete**
- `npm ci` reports `4 packages had install scripts blocked` (esbuild, sharp, tesseract.js,
  unrs-resolver) and completes exit 0, but `node_modules/.bin/vitest`, `.bin/next` and
  `.bin/eslint` are absent, so `npm test` / `npm run lint` fail with "not recognized".
- **Impact:** the documented validation commands in §6 of the task brief cannot run as written.
  Worked around this run by invoking the package entry points directly. **This is an environment
  problem, not a repo problem** — do not "fix" it by committing bin stubs.
- **Fix:** `npm install-scripts approve <pkg>` locally, or run validation in CI (see #26).

### Newly discovered 2026-09-28

**42. `docs/MAINTENANCE.md` does not exist on `main` — every backlog update conflicts**
- Confirmed by `git ls-tree main --name-only`: `main` has no `docs/` directory at all. The
  document exists only on `chore/maintenance-doc` and `fix/approve-session-null-member-rows`,
  neither of which is merged.
- **Impact:** every branch that must update the backlog (per the daily-run instructions) has to
  import the file from another unmerged branch. The 2026-09-28 run had to do exactly that, and
  the next run will do it again. Whichever doc-bearing PR merges first will conflict with the
  others in `docs/MAINTENANCE.md`, which is a ~570-line file that every run edits.
- **Fix:** merge `chore/maintenance-doc` (or the `docs/` part of
  `fix/approve-session-null-member-rows`) **first**, before merging further feature work, so
  `main` carries the backlog and subsequent runs can edit it normally.
- **Process note:** this run deliberately did **not** rebase onto another branch or merge
  either existing PR, to keep its own diff reviewable and single-purpose.

**43. `getUser()` failure is a returned `error`, not a throw — the classic destructure hides it**
- `middleware.ts:19` (pre-fix) — `const { data: { user } } = await supabase.auth.getUser();`
  discards the `error` field entirely.
- `GoTrueClient._getUser` catches network failures and **returns** them (e.g. as
  `AuthRetryableFetchError`) rather than throwing. So on a transient Auth outage the
  destructured `user` is simply `null` — indistinguishable from "genuinely signed out" — and
  the middleware redirects every user to `/login`.
- **Impact:** an Auth blip logs out the entire user base. This was **not** in the original
  backlog; it was found while fixing #2, and it is the same class of bug as #23 (an error path
  that is swallowed rather than surfaced).
- **Fixed** in the 2026-09-28 run, alongside #2. Listed here because the *pattern* recurs
  across the codebase: **any `const { data } = await supabase...` without also handling
  `error` has the same defect.** `src/app/attendance/new/page.tsx:24-27` (item #8) and
  `src/app/sessions/[id]/success/page.tsx:33` are both live instances.
- **Fix pattern to apply elsewhere:** destructure `{ data, error }` and branch on `error`
  explicitly; never infer "no data" from a missing `user`.

---

## 7. Note on the uncommitted working-tree change

At review time the working tree carried one uncommitted modification to
`src/matching/matchEngine.ts` (16 lines removed, 1 added).

**This is a safe de-duplication, not a regression.** Commit `5f52560` ("prioritize exact matches
over corrections") already introduced an identical step-0 exact-match block at lines 30-43, which
runs *before* the correction lookup — making the deleted block (old lines 59-73) unreachable dead
code. The genuine defect is `m.id.toLowerCase().includes(lowerName)` at line 34, which survives
in the retained block and is backlog item **#1**.

**Still requires a decision:** whether to commit this de-duplication or discard it. It is
untracked work sitting in the working tree, and the daily cron job runs against this same
checkout — so it must be resolved before automated runs begin, or the job will operate on a
dirty tree.

**2026-09-27 run — the change was left in place, untouched and uncommitted.** The P0 work
selected that day (`approve_session`, `database/schema.sql`) required no edit to
`src/matching/matchEngine.ts`, so the file was deliberately excluded from the commit to avoid
absorbing this undecided work into someone else's branch.

**Consequence, and it is a real cost:** backlog **#39** (the `minConfidence` floor — the
`matchEngine.ts` half of old #4) is *implementable today* but was skipped specifically to keep
this file clean. Committing or discarding the de-duplication is therefore the highest-leverage
unblock in the repo: it costs one `git add src/matching/matchEngine.ts` or one
`git checkout -- src/matching/matchEngine.ts`, and it converts #39 from blocked to a normal P0.

**2026-09-28 run — the change was left in place, untouched and uncommitted, for the second
consecutive day.** The P0 selected today (#2, the auth storage split) also required no edit to
`src/matching/matchEngine.ts`, so the same exclusion applied and the file is again absent from
the commit. The change is still present in the working tree — verified at the start of this run
and again at the end.

**This is now a two-day-old unblock, and it is the bottleneck.** Both #1 (the most severe
remaining defect) and #39 require editing this exact file. Every daily run that picks any other
item will keep hitting the same wall, so the cost is no longer hypothetical.

**Recommendation to the repo owner (a decision, not an automated action):**
`git add src/matching/matchEngine.ts && git commit -m "chore: remove unreachable duplicate
exact-match block"` on its own branch. The de-duplication was analysed on 2026-09-26 and
found safe; the only thing holding it is that no one has reviewed and committed it. Doing so
unblocks #1 and #39 — the two highest-severity open items — in one line of work.

---

## 8. Why `attendance.member_id` was NOT made `NOT NULL`

The fix for #3 (2026-09-27) did **not** apply the `ALTER TABLE attendance ALTER COLUMN member_id
SET NOT NULL` hardening that the original item proposed. This is a deliberate, reversible
decision, recorded so a later run does not "helpfully" re-add it.

**Why it was skipped:** `SET NOT NULL` on a column that *already contains* NULLs fails. The rows
this bug produced are, by definition, still in the production `attendance` table — one junk row
per unmatched line per approval, accumulating since the feature shipped. The constraint therefore
requires a data migration first:

```sql
-- 1. How bad is it, in production?
SELECT count(*) FROM attendance WHERE member_id IS NULL;

-- 2. Unrecoverable: no member was ever resolved, so they cannot be attributed to a person
--    and cannot be backfilled. They must be deleted (or parked for audit - see below).
DELETE FROM attendance WHERE member_id IS NULL;

-- 3. Only then:
ALTER TABLE attendance ALTER COLUMN member_id SET NOT NULL;
```

**Why it still matters, and is deferred rather than dropped:** with the `WHERE` fix alone, a
*future* bad write is prevented, but nothing makes the class of bug **unrepresentable** — a
second code path, a future migration, or a manual `INSERT` could reintroduce NULL members, and
the NULL-distinct unique index would again fail to catch it. The constraint is the real
structural fix.

**Why not now:** step 2 is a destructive `DELETE` against a live attendance table in a
production database this agent cannot inspect. Deciding what a historical "someone was possibly
on this register" record means — delete it, or park it in an `attendance_unresolved` table for
audit — is a business decision, not an automated one. **Requires a human decision plus a verified
backup.** Tracked as the tail of #3.

**Interim safety:** the `WHERE` clause now requires `jsonb_typeof(...) = 'object'` and a
UUID-shaped id, and the existing FK on `attendance.member_id` is the backstop for
well-formed-but-unknown ids. A NULL member can no longer originate from `approve_session`.

---

## 9. Merge order matters — three open PRs, one of them the backlog itself

As of 2026-09-28 there are **three** open PRs against `main`, and they are **not independent**:

| PR | Branch | Touches |
|---|---|---|
| #1 | `chore/maintenance-doc` | `docs/MAINTENANCE.md` (adds it) |
| #2 | `fix/approve-session-null-member-rows` | `database/schema.sql`, `package.json`, `package-lock.json`, `docs/MAINTENANCE.md`, `src/services/approveSession.test.ts` |
| #3 | `fix/supabase-cookie-session-matches-middleware` | `middleware.ts`, `src/lib/supabase.ts`, two new test files, `docs/MAINTENANCE.md` |

**All three edit `docs/MAINTENANCE.md`, and `main` does not contain that file at all** (#42).
Merging them in the wrong order produces a large, noisy conflict in a 640-line document that
no human will want to resolve.

**Recommended order for the repo owner:**
1. `chore/maintenance-doc` — gets the backlog onto `main`. Smallest diff, and it makes every
   later doc update a normal edit instead of a cross-branch import.
2. `fix/approve-session-null-member-rows` (#3 closed) — real P0, silent data corruption.
3. `fix/supabase-cookie-session-matches-middleware` (#2 closed) — real P0, app unusable.

Steps 2 and 3 touch disjoint code (`database/schema.sql` and its test vs `middleware.ts`,
`src/lib/supabase.ts` and their tests), so they can merge in either order; only the shared
`docs/MAINTENANCE.md` needs care. **Do not merge #3 before at least one doc-bearing PR has
landed, or the conflict is unavoidable.**

