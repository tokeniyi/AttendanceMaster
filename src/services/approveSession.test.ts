import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Regression tests for `approve_session` in database/schema.sql (backlog #3 and #4).
 *
 * This is the actual enforcement point for every write to the `attendance` table, and it
 * had zero coverage: the one tested approval helper (src/services/approval.ts) has no
 * production caller. These tests execute the real function body against a real Postgres
 * (PGlite) rather than re-implementing its logic in TypeScript, so a regression in the SQL
 * cannot be masked by the test asserting its own copy of the filter.
 *
 * The schema is loaded straight from disk with the Supabase/PostgREST-specific parts
 * (auth schema, auth.uid(), RLS policies) stripped, because those are supplied by the
 * Supabase platform and are not available locally. Everything the function itself depends
 * on - jsonb semantics, the ::UUID cast, the FK, the unique index, ON CONFLICT - is real.
 */

const SCHEMA_PATH = path.resolve(__dirname, "../../database/schema.sql");

/** Strips the auth-dependent objects that only exist inside a Supabase project. */
function loadSchema(): string {
  const raw = readFileSync(SCHEMA_PATH, "utf8");
  return raw
    // auth.users(id) is a Supabase-managed FK target.
    .replaceAll("UUID REFERENCES auth.users(id) ON DELETE CASCADE", "UUID")
    // auth.uid() is Supabase's request-scoped identity. Tests set it explicitly instead,
    // so that the ownership check inside approve_session stays under test rather than
    // being hardcoded away.
    .replaceAll("owner_id = auth.uid()", "owner_id = current_setting('test.user_id')::UUID")
    .split("\n")
    .filter(line => !/^\s*CREATE POLICY/.test(line))
    .join("\n");
}

let db: PGlite;
const OWNER = "11111111-1111-4111-8111-111111111111";
const ADA = "22222222-2222-4222-8222-222222222222";
const GRACE = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";

const member = (id: string, name: string) => ({ id, full_name: name, aliases: [], created_at: "" });

/**
 * One row of the payload the workspace passes to approve_session
 * (sessions/[id]/page.tsx:227). Built as an object, not a pre-stringified JSON string:
 * p_rows is a JSONB *array of objects*, so each element must serialize to an object for
 * `row->'suggestedMember'` to resolve.
 */
const rowFor = (id: string, name: string, status: string, extra: Record<string, unknown> = {}) => ({
  ocrName: name,
  suggestedMember: member(id, name),
  status,
  ...extra,
});

const unmatchedRow = (name: string) => ({ ocrName: name, suggestedMember: null, status: "none" });

const withMember = (o: Record<string, unknown>, id: string, name: string) => ({
  ...o,
  suggestedMember: member(id, name),
});

beforeAll(async () => {
  db = new PGlite();
  await db.exec(loadSchema());
  await db.exec(`INSERT INTO members (id, full_name) VALUES
    ('${ADA}', 'Ada Lovelace'),
    ('${GRACE}', 'Grace Hopper')`);
  await db.exec(`SET test.user_id = '${OWNER}'`);
  await db.exec(`INSERT INTO sessions (id, owner_id, event_name, session_date, status)
    VALUES ('${SESSION}', '${OWNER}', 'Weekly Sync', '2026-09-27', 'pending')`);
}, 60_000);

beforeEach(async () => {
  await db.exec("TRUNCATE attendance");
});

/** The rows approve_session actually wrote, most useful assertion surface for a data-corruption bug. */
async function writtenRows() {
  const r = await db.query<{ member_id: string | null; present: boolean; event_name: string }>(
    "SELECT member_id, present, event_name FROM attendance ORDER BY member_id",
  );
  return r.rows;
}

/** One row as it arrives in p_rows - a JSON object, not a pre-stringified string. */
type RowPayload = Record<string, unknown>;

const approved = (rows: RowPayload[]) =>
  db.query("SELECT approve_session($1::UUID, $2::JSONB)", [SESSION, JSON.stringify(rows)]);

describe("approve_session", () => {
  it("records a matched, unflagged row", async () => {
    await approved([rowFor(ADA, "Ada Lovelace", "approved")]);
    expect(await writtenRows()).toEqual([
      { member_id: ADA, present: true, event_name: "Weekly Sync" },
    ]);
  });

  it("records rows matched by fuzzy match and by learned correction, not just 'approved'", async () => {
    // #3/#4 are about the member and flag filters. An operator-corrected or fuzzy-matched
    // row they accepted is legitimately attendance and must not be silently dropped,
    // otherwise the fix would over-correct into under-recording.
    await approved([rowFor(ADA, "Ada Lovelace", "exact"), rowFor(GRACE, "Grace Hopper", "fuzzy")]);
    expect((await writtenRows()).map(r => r.member_id)).toEqual([ADA, GRACE]);
  });

  // --- #3: the silent NULL-member corruption ---

  it("writes no attendance row for an unmatched row (JSON null is not SQL NULL)", async () => {
    // The core regression. `row->'suggestedMember' IS NOT NULL` is TRUE for a JSON null,
    // so this row used to be inserted with member_id = NULL. Because the unique index
    // (session_id, member_id) is NULL-distinct, each approval appended another junk row
    // instead of upserting, so the corruption compounded on every re-approval.
    await approved([
      unmatchedRow("Nobody Here"),
      rowFor(ADA, "Ada Lovelace", "approved"),
    ]);
    expect(await writtenRows()).toEqual([{ member_id: ADA, present: true, event_name: "Weekly Sync" }]);
  });

  it("writes no attendance row for a row whose suggestedMember is a non-object", async () => {
    // Defence in depth: client-supplied JSON can carry any shape, not just the six
    // statuses the UI produces. Note that a `suggestedMember` that is a *non-empty*
    // non-object (e.g. the string "some-id") used to crash the whole approval via the
    // ::UUID cast, and an *empty* one used to insert a NULL member.
    for (const bogus of [undefined, "a string", 42, true, [], { id: null }, {}]) {
      await approved([{ ocrName: "X", suggestedMember: bogus, status: "none" }]);
      expect(await writtenRows()).toEqual([]);
    }
  });

  it("does not accumulate one junk row per unmatched line across repeated approvals", async () => {
    const rows = [unmatchedRow("Nobody Here"), rowFor(ADA, "Ada Lovelace", "approved")];
    await approved(rows);
    await approved(rows);
    await approved(rows);
    expect(await writtenRows()).toHaveLength(1);
  });

  it("does not abort the whole approval on a malformed member id", async () => {
    // The ::UUID cast is only total because the WHERE clause requires UUID shape. Without
    // that requirement a single malformed client-supplied id raised an
    // invalid-text-representation error and rolled back the operator's entire approval,
    // losing the legitimate rows too.
    await approved([
      rowFor("not-a-uuid", "Garbled", "approved"),
      rowFor(ADA, "Ada Lovelace", "approved"),
    ]);
    expect((await writtenRows()).map(r => r.member_id)).toEqual([ADA]);
  });

  // --- #4: the advisory review gate ---

  it("does not record a row the operator flagged, even when it has a valid member", async () => {
    // A flagged row can still carry a suggestedMember: the OCR text was wrong, the member
    // is still attached. Excluding by "no member" would not catch it, so the flag itself
    // must be honoured.
    await approved([rowFor(ADA, "Ada Lovelace", "flagged")]);
    expect(await writtenRows()).toEqual([]);
  });

  it("excludes headers and title/footer rows from attendance", async () => {
    await approved([
      withMember({ ocrName: "Name", status: "none", isHeader: true }, ADA, "Ada Lovelace"),
      withMember(
        { ocrName: "Ada Lovelace", status: "approved", isHeader: true },
        GRACE,
        "Grace Hopper",
      ),
    ]);
    expect(await writtenRows()).toEqual([]);
  });

  it("upserts rather than duplicating when the same member appears twice", async () => {
    await approved([rowFor(ADA, "Ada Lovelace", "approved", { present: true })]);
    await approved([rowFor(ADA, "Ada Lovelace", "approved", { present: false })]);
    expect(await writtenRows()).toEqual([{ member_id: ADA, present: false, event_name: "Weekly Sync" }]);
  });

  it("rejects a caller who does not own the session", async () => {
    await db.exec(`SET test.user_id = '${GRACE}'`);
    await expect(approved([rowFor(ADA, "Ada Lovelace", "approved")])).rejects.toThrow(
      /Session not found or not owned/,
    );
    expect(await writtenRows()).toEqual([]);
    await db.exec(`SET test.user_id = '${OWNER}'`);
  });
});
