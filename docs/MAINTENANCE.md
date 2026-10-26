# AttendanceMaster — Maintenance & Development Backlog

> **This document is the source of truth for automated daily development runs.**
> It is updated on every task branch. Daily runs must re-read it *and* the code
> before choosing work — never trust a previous run's analysis.

- **Repository:** `tokeniyi/AttendanceMaster`
- **Description:** OCR-based attendance register marking (Next.js 15, Supabase, tesseract.js, Fuse.js)
- **Default branch:** `main` (protected — never pushed to directly)
- **Review baseline:** commit `1c8c401`
- **Last reviewed:** 2026-10-03

> **CRITICAL — `main` is currently BROKEN (found 2026-10-01).**
> Commit `5f52560` added a step-0 exact-match block to `matchEngine.ts` but did not delete
> the pre-existing one at old lines 59-73. Both declare `const exactMatch` in the same
> block scope, so **`main` does not compile**: `npm test` fails with
> `The symbol "exactMatch" has already been declared`, `npx tsc --noEmit` reports
> `TS2451: Cannot redeclare block-scoped variable 'exactMatch'` at lines 31 and 60, and
> `npm run build` fails. All 5 open PRs are based on this broken `main` and will not pass
> CI until it is fixed. **This is fixed by branch `fix/anchor-id-exact-match` (backlog
> #1)** — merge that PR first; the other PRs rebase onto it. Note that the "uncommitted
> working-tree change" described in §7 is exactly this de-duplication and is the same fix.

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

- **`main` does not compile.** See the banner at the top. Fixed on `fix/anchor-id-exact-match`;
  all 5 open PRs depend on that being merged.
- **4 P0 bugs remain open** (#2, #3, #4, #5) — three of which are **silent data corruption**
  into the `attendance` table. All four are already covered by open PRs #2, #3, #4, #5.
- The most severe *remaining* bug is **#4** — `flagRow` is advisory only, so rows the operator
  explicitly flagged as wrong are written to `attendance` as `present = TRUE`. PR #2 fixes the
  SQL half; the client-side approval gate is still open.
- **Two halves of the app use incompatible auth strategies** (cookies vs `localStorage`),
  with no bridge — the app is expected to be unusable in any deployment where middleware runs.
  (PR #3.)
- **Four shipped-looking features are permanently dead** because three semantic fields are
  dropped before persistence (the "Approve All Data" button approves *zero rows*). (PR #4.)
- **Security:** `members` and `corrections` are readable *and writable* by every authenticated
  user, exposing `full_name`, `email`, `phone`, `department` across tenants. **Unaddressed —
  no PR. This is now the sharpest unclaimed risk in the repo (#13).**
- **Testing:** two test files. `matchEngine` is now well covered (23 cases, verified to fail
  against the pre-fix code); the approval path and the entire SQL layer still have zero coverage.

---

## 3. Backlog

### P0 — Critical bugs (ship-blockers; silent data corruption)

**0. `main` does not compile — duplicate `const exactMatch` — ✅ FIXED (branch `fix/anchor-id-exact-match`)**
- `src/matching/matchEngine.ts:31` and `:60` on `main`
- **Verified by execution.** Introduced by `5f52560`. All 5 open PRs are affected.
- **Fix applied:** collapsed the two blocks into one step-0 block and deleted the duplicate.
- See the banner at the top of this document.

**1. `m.id.toLowerCase().includes(lowerName)` matches arbitrary OCR fragments as a 1.0-confidence exact match — ✅ FIXED (branch `fix/anchor-id-exact-match`)**
- `src/matching/matchEngine.ts:34` on `main`
- **Verified by execution.** `member.id` is a UUID (`schema.sql:3`). A one- or two-character
  OCR artifact — `"a"`, `"d"`, `"0"`, `"-"` — is a *substring* of nearly every UUID, so
  `members.find` returns the first roster member whose UUID contains it, at
  `confidence: 1.0, status: 'exact'`. Single letters and punctuation are exactly what OCR of
  a noisy table cell produces.
- **Impact:** flows into `suggested_table` → `approve_session` → a wrong-person `attendance`
  row, displayed to the operator as maximally confident.
- **Fix applied:** the id check is now **anchored** — `m.id.toLowerCase() === lowerName`,
  guarded by `MIN_ID_MATCH_LENGTH = 6`. Whole-id equality is the only correct form of id
  matching (a substring test against a UUID has none) and is also *total*: at most one member
  can own a given id, so `members.find` cannot return an arbitrary earlier member.
  Name and alias matching are unchanged — those are genuine whole-string comparisons.
- **Behaviour change to be aware of:** an OCR cell that used to become a bogus `exact` match
  now resolves through the fuzzy path or falls through to `status: 'none'`. A 1–2 character
  fragment that genuinely fuzzy-matches a name/alias is still returned, but at `fuzzy`
  confidence, not `1.0/exact`. This is the intended outcome.
- **Files:** `src/matching/matchEngine.ts`, `src/matching/matchEngine.test.ts`
- **Tests added:** 23 cases in `matchEngine.test.ts`. **Verified by execution that 13 of them
  FAIL against the pre-fix code and all 24 pass after** — they are genuine regression tests,
  not tautologies.

**1b. Real id matching is not actually implemented — 🆕 OPEN (P1)**
- Matching a member by a *human-entered* id/number is a plausible intent of the original
  clause, but `members` has **no numeric column** (`schema.sql:4-8` = `id, full_name,
  email, phone, department, created_at`). `id` is an internal UUID that a human would never
  read off a register, so the feature the clause was trying to serve **cannot work** as
  written — the correct conclusion is that whole-UUID matching (what fix #1 now does) is the
  right behaviour, and no separate numeric field is needed.
- If id-number matching is genuinely wanted later, it needs a **new** column on `members`
  (e.g. `reg_no TEXT UNIQUE`) matched with `^`/`$`. That is a schema migration (#27), not a
  bug fix.

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
- **STATUS 2026-10-03 — fuzzy half CLOSED on `fix/fuzzy-confidence-floor`; the UI half and
  the SQL half are separate open PRs.**
  **The prescribed `minConfidence` floor is NOT implementable as written, and this was
  verified by execution, not assumed.** Measuring a 4-member roster with the shipped
  `threshold: 0.35`:
  - 13 of 22 junk fragments (`"a"`, `"Ad"`, `"gh"`, `"Ma"`, `"Lo"`, `"Ok"`, …) resolved to a
    real person at `status:'fuzzy'`, **at confidence 0.9672–0.9959** — and this was *after*
    PR #6 anchored the exact-id path. The fuzzy path was left completely open.
  - Genuinely misread **real** names scored **0.588–0.760** (`"Ada Lovclacc"` 0.588,
    `"Grace Hoppr"` 0.695, `"Chinelo Okonkw"` 0.967 as a truncation).
  - So the two populations **overlap**: at floor 0.7 all 13 junk entries survive and 11/15
    real matches survive; at 0.95 all 13 junk entries still survive. Fuse scores
    edit-distance *ratios*, and a short query against a long name scores near-optimistically.
  - **Length separates them perfectly**: junk ≤2 chars, every legitimate match ≥4.
  - **What shipped instead:** `MIN_FUZZY_MATCH_LENGTH = 3` gates the *fuzzy* path only
    (`matchEngine.ts`). Short text returns `status:'none'` — no suggestion — leaving the row
    for the operator instead of pre-filling the wrong person. At 3, all 13 junk fragments
    are rejected and all 13 legitimate short names still resolve; 5 would reject real short
    names without rejecting any extra junk.
  - Exact name/alias matches and learned corrections are deliberately **untouched** — both
    are authoritative decisions, not fuzzy guesses.
  - **Still open:** the SQL `WHERE` half (exclude `status='flagged'`) — PR #2; the
    finalize-button review gate — PR #7; and SQL-level tests for the row-selection
    contract (#28).
  - **Newly discovered (2026-10-03):** a confidence floor is the wrong instrument *for any*
    fuzzy matcher here, because confidence and correctness are anti-correlated at short
    lengths. Any future attempt to add one should be rejected with this measurement in hand.

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

**12. No regression test for the exact-over-correction precedence that commit `5f52560` introduced — ✅ FIXED (branch `fix/anchor-id-exact-match`)**
- `src/matching/matchEngine.test.ts:7-11`
- The test named *"prefers learned corrections"* now describes the **opposite** of the
  implemented contract, and passes only because `"Adaa"` has no exact match.
- **Fix applied:** added a case where `"Ada"` **both** exactly matches `ada`'s alias **and** has
  a learned correction pointing at `grace`, asserting `status === 'exact'` and
  `suggestedMember.id === ada.id`. The original case was renamed to *"falls back to a learned
  correction when there is no exact match"*, which is what it actually pinned.
- Verified: both cases pass, and the precedence case fails if step 0 is reordered below step 1.

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

**39. `docs/MAINTENANCE.md` has forked across six branches and does not exist on `main`**
- New item, 2026-10-03. The document that every automated run treats as its source of truth
  lives only on `chore/maintenance-doc` (PR #1, unmerged), and five other PR branches each
  carry a **different revision of it**. Two 2026-10-02 runs therefore recorded *contradictory*
  states for P0 #4 — one claiming the review gate was already closed, the other still listing
  it as open — because each was reading its own branch's copy.
- **Impact:** a future run can silently trust a stale or contradicted analysis. This run
  stacked on `fix/anchor-id-exact-match` and had to reconcile two revisions by hand.
- **Fix:** merge PR #1 first, then rebase the open branches onto it and rebase each later
  run's doc edit on the merged copy. Until then, treat the document as advisory and
  re-verify every item against the actual code — which is the right practice anyway (§2).

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

- **Two test files.** `src/matching/matchEngine.test.ts` (23 cases) and
  `src/services/approval.test.ts` (1 case).
- `matchEngine` is now genuinely covered — it is the one module that is pure logic, and the
  test suite was **verified by execution to fail 13/24 against the pre-fix code**, so the
  cases are load-bearing rather than decorative.
- **Still untested:** the entire OCR pipeline (`ocrService`, `tableSegmenter`, `computerVision`,
  `dataCorrector`, `semanticAnalyzer`), all Supabase access, all routes and components, and —
  critically — `database/schema.sql`, which is the actual enforcement point for attendance writes.
- **The one other tested component never runs in production** (#11), so the approval path has
  effectively **zero** coverage of the code that matters.
- **Highest-value next tests:** (a) SQL tests for `approve_session` (#28) — this is the
  enforcement point for bugs #3 and #4 and has no coverage at all, (b) the `serial` header
  misclassification (#9), (c) the inverted `validateRow` correction condition (#7), both of
  which are data-destroying and currently unverified by execution.

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
| 2026-10-01 | `fix/anchor-id-exact-match` | **#0** `main` does not compile (duplicate `const exactMatch` from `5f52560`) + **#1** UUID-substring match reported as `exact` @ 1.0 confidence + **#12** exact-over-correction regression test | this run | 24/24 tests, `tsc` 0 errors, lint 0 errors. **13 of the new tests verified to FAIL against the pre-fix code.** Precedence test verified to fail if step 0 is reordered. |
| 2026-10-03 | `fix/fuzzy-confidence-floor` | **#4 (fuzzy half)** — 1–2 char OCR fragments resolved to real people at 0.967–0.996 confidence via the fuzzy path, which PR #6 left open | this run | 52/52 tests, lint 0 errors (4 pre-existing warnings), `tsc` clean. **14 of the new tests verified to FAIL against the pre-fix code.** The `minConfidence` floor prescribed by the backlog was rejected as unimplementable — see #4. |

**Remaining backlog:** 5 × P0 (#2–#5 + #1b reclassified to P1), 19 × P1, 5 × P2, 8 × P3.
**Closed so far:** #0, #1, #12 (3 of 41) + the fuzzy half of #4. **All four remaining P0 bugs
already have open PRs** — do not start them again; check for a merge first.

> **Stale-analysis note (2026-10-03).** `docs/MAINTENANCE.md` does **not** exist on `main` —
> it lives only on the unmerged `chore/maintenance-doc` branch (PR #1). Worse, the doc has
> **forked**: `fix/anchor-id-exact-match`, `fix/approve-session-null-member-rows`,
> `fix/supabase-cookie-session-matches-middleware`, `fix/persist-ocr-semantic-fields` and
> `fix/upload-validation-shows-error` all edit their own copy, and `fix/finalize-review-gate`
> carries yet another revision. This run stacked on `fix/anchor-id-exact-match`, so its
> baseline text is that branch's copy. **Until PR #1 and one canonical doc land, every run must
> expect to hand-merge doc conflicts.** This is now a blocker worth its own item (#39, P2).

### Recommended order for the next runs

1. **#13 — `members`/`corrections` RLS is `USING (true)` across tenants.** The only P0-class
   item with **no PR against it**, and a live PII exposure (`full_name`, `email`, `phone`,
   `department` readable and writable by any signed-up user). Highest risk × zero coverage.
   *Unchanged — still the top recommendation.*
2. **#2 — the cookie/`localStorage` auth split** (PR #3 is open but unmerged). With the app
   expected to be unusable wherever the middleware runs, no other fix is testable end-to-end
   until this merges. Consider flagging to the user as the merge priority.
3. **#4's SQL half** — PR #2 must land for the `status='flagged'` exclusion to exist at all.
4. **#7 — the inverted `validateRow` condition.** Data-destroying and *unverified by execution*.
5. **#9 — unanchored `/no\.?/` classifies `Notes`/`Nomination` as `serial`.** Data-destroying,
   also unverified by execution (the original review claimed verification; re-verify before fixing).
6. **#28 — SQL tests for `approve_session`.** The real enforcement point for #3/#4 has zero coverage.

> **Do not attempt P0 #4's `minConfidence` floor again.** It is now measured to be the wrong
> instrument; see the 2026-10-03 STATUS note under item #4 for the numbers.

**Note on every branch from here:** work in a `git worktree`, not the main checkout. The main
checkout carries an uncommitted `src/matching/matchEngine.ts` edit (§7) that automated runs must
not stage. On Windows a `node_modules` **junction** between worktrees corrupts the shared
directory (symlink deletion follows the link) — use a real `npm ci` per worktree.

---

## 7. Note on the uncommitted working-tree change

**RESOLVED 2026-10-01.** The main checkout still carries the same uncommitted modification to
`src/matching/matchEngine.ts` (16 lines removed, 1 added) — it was left untouched on purpose.
That change is **the de-duplication half of PR `fix/anchor-id-exact-match`**: commit `5f52560`
added an identical step-0 exact-match block at lines 30-43 which runs before the correction
lookup, making the deleted block (old lines 59-73) unreachable dead code — and, more seriously,
**that duplication is why `main` no longer compiles.**

So the working-tree edit is no longer a mystery and no longer a decision for the user: once PR
`fix/anchor-id-exact-match` merges, that checkout can simply be reset (`git checkout --
src/matching/matchEngine.ts`) because the merged branch contains the same change.

**Still unresolved:** the substantive defect in the retained block,
`m.id.toLowerCase().includes(lowerName)`, was **backlog item #1** and is fixed on the same
branch (now anchored to whole-id equality).
