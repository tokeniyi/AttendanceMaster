# Plan: per-owner isolation for `members` and `corrections` (backlog #13)

Status: **plan written and validated against code 2026-11-10; no stage implemented yet.**

## Problem
`database/schema.sql` gives `members` and `corrections` the policy
`FOR ALL TO authenticated USING (true) WITH CHECK (true)`. Any signed-in user can read and write
every user's roster, including `phone` and `email`. `sessions` is already owner-scoped
(`owner_id = auth.uid()`), so the roster is the one tenant-leaking table (plus `import_mappings`,
which the app never touches).

## Decision recorded (owner was never asked; unattended run)
Assume **per-user rosters** (each signed-in user owns their members), matching how `sessions` and
`attendance` already work. If the owner actually wants one shared roster for a single organisation,
the alternative is a `profiles`/`org_members` table; this plan then does not apply and the policy
should instead restrict sign-up. The owner should confirm before Stage 2 is applied to production.

## Validation against the code (done this run)
- Roster access points: `attendance/new/page.tsx:38-39` (select members + corrections),
  `sessions/[id]/page.tsx:79` (select members), `members/page.tsx:27,42` (select, CSV insert),
  `page.tsx:30` (count). All run as the signed-in user via the anon client, so RLS applies to them
  and **no app query needs a filter change**: owner-scoped policies narrow results automatically.
- `members/page.tsx:42` inserts rows from `parseMemberCSV` without `owner_id`. A column default of
  `auth.uid()` makes this work unchanged. Without the default every CSV import would fail the
  `WITH CHECK`.
- **`upsert_correction` is never called by the app** (grep of `src`: no `rpc('upsert_correction')`).
  The `corrections` table is read but never written, so "correction learning" is dormant. The
  corrections change is therefore low-risk but also low-value until a caller exists.
- `corrections.incorrect_text` is globally `UNIQUE`; with per-owner rows two users cannot learn the
  same misread. Must become `UNIQUE (owner_id, incorrect_text)` and `upsert_correction`'s
  `ON CONFLICT` target must change with it.
- `attendance.member_id` has an FK to `members`. FK checks bypass RLS, so a user could write an
  attendance row pointing at another user's member id via `approve_session` (the id comes from
  client JSON). `approve_session` must also require the member to belong to `auth.uid()`.
- `ON DELETE CASCADE` from members to attendance/corrections is unchanged.
- Existing rows have no owner. Backfill needs a human choice (see Stage 2).

## Stages (each leaves tests passing; SQL stages cannot be exercised by Vitest)
1. **Schema file + docs only, no policy change.** Add `owner_id UUID REFERENCES auth.users(id)
   ON DELETE CASCADE DEFAULT auth.uid()` (nullable) to `members` and `corrections`; add indexes
   on `owner_id`. Safe to apply: existing policies keep working. Add
   `database/migrations/` notes if backlog #27 has landed.
2. **Backfill (owner action).** `UPDATE members SET owner_id = '<owner uuid>' WHERE owner_id IS NULL;`
   same for `corrections`. Then `SET NOT NULL`. Document the exact statements; do not run them
   automatically.
3. **Tighten policies.** Replace the two `USING (true)` policies with
   `USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid())`. Change corrections uniqueness
   to `(owner_id, incorrect_text)` and update `upsert_correction`. Update `approve_session` to add
   `AND EXISTS (SELECT 1 FROM members m WHERE m.id = (row->'suggestedMember'->>'id')::UUID AND m.owner_id = auth.uid())`
   to the attendance insert filter.
4. **Tests.** Add SQL tests (`supabase test db`, backlog #28) covering: user B cannot select/insert/
   update user A's members; CSV insert without `owner_id` succeeds via the default;
   `approve_session` ignores a foreign member id; same `incorrect_text` for two owners is allowed.
5. **Optional:** call `upsert_correction` from the workspace when an operator manually fixes a match.

## Risks
- Stage 3 before Stage 2 hides all existing members from everyone (NULL owner matches nothing).
  Order matters; the schema file should not ship Stage 3 until the owner confirms the backfill.
- `schema.sql` is re-run as a whole by hand; `CREATE POLICY` is not idempotent, so Stage 3 must
  add `DROP POLICY IF EXISTS` for the new names too.

## Open question for the owner
Per-user rosters (this plan) or one shared roster per organisation?
