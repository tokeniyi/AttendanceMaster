import { describe, expect, it } from "vitest";
import { matchMembers } from "./matchEngine";

// Realistic UUIDs, as used by database/schema.sql.
const ada = {
  id: "3f2b1a4c-9d8e-4f7a-b6c5-1a2b3c4d5e6f",
  full_name: "Ada Lovelace",
  aliases: ["Ada"],
  created_at: "",
};
const grace = {
  id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  full_name: "Grace Hopper",
  aliases: [],
  created_at: "",
};
const roster = [ada, grace];

describe("matchMembers", () => {
  it("matches a full name exactly", () => {
    const [result] = matchMembers(["Ada Lovelace"], roster, []);
    expect(result.suggestedMember?.id).toBe(ada.id);
    expect(result.status).toBe("exact");
    expect(result.confidence).toBe(1.0);
  });

  it("matches an alias exactly", () => {
    const [result] = matchMembers(["ada"], roster, []);
    expect(result.suggestedMember?.id).toBe(ada.id);
    expect(result.status).toBe("exact");
  });

  // --- P0 #1: UUID substring regression -------------------------------------
  describe("id matching is anchored, not a substring test", () => {
    // Each of these is a substring of at least one roster UUID. Under the old
    // `m.id.toLowerCase().includes(lowerName)` each returned the first roster
    // member whose UUID contained it, at confidence 1.0 / status "exact" — which
    // then became a wrong-person attendance row via approve_session.
    it.each([
      "a",
      "d",
      "0",
      "-",
      "3f2b",
      "1a2b3c4d5e6f",
      "9d8e-4f7a",
      "b6c5-1a2b",
    ])("never resolves the id fragment %j via the exact-id path", (fragment) => {
      const [result] = matchMembers([fragment], roster, []);
      // The defect was a substring test reporting `exact` at confidence 1.0.
      // No fragment may reach `exact`, and none may claim full confidence.
      expect(result.status).not.toBe("exact");
      expect(result.confidence).not.toBe(1.0);
    });

    it.each(["a", "d", "0", "-", "3f2b"])(
      "resolves the short fragment %j independently of any roster UUID",
      (fragment) => {
        // Two rosters with identical names but completely different UUIDs. Under
        // the substring bug, `members.find` walked the roster in order and
        // returned whoever's UUID happened to contain the fragment, so these two
        // runs could differ purely because of id content. With the id path
        // anchored, the result can depend only on the names — so it must be
        // identical for both.
        const otherUuidRoster = [
          { ...ada, id: "ffffffff-0000-4000-8000-000000000000" },
          { ...grace, id: "00000000-ffff-4fff-bfff-ffffffffffff" },
        ];
        // Compare only the decision, not the embedded member object (which
        // carries its own id by definition).
        const decide = (r: ReturnType<typeof matchMembers>[number]) => ({
          ocrName: r.ocrName,
          status: r.status,
          confidence: r.confidence,
          matchedName: r.suggestedMember?.full_name ?? null,
        });
        expect(decide(matchMembers([fragment], roster, [])[0])).toEqual(
          decide(matchMembers([fragment], otherUuidRoster, [])[0]),
        );
      },
    );

    it("accepts a whole, full-length uuid as an exact match", () => {
      const [result] = matchMembers([grace.id], roster, []);
      expect(result.suggestedMember?.id).toBe(grace.id);
      expect(result.status).toBe("exact");
    });

    it("does not match a uuid with a character missing", () => {
      const truncated = grace.id.slice(0, -1);
      const [result] = matchMembers([truncated], roster, []);
      expect(result.suggestedMember?.id).not.toBe(grace.id);
    });
  });

  // --- #12: exact-over-correction precedence --------------------------------
  it("prefers an exact match over a learned correction for the same text", () => {
    // "Ada" both exactly matches ada's alias AND has a learned correction
    // pointing at grace. Exact is more reliable, so exact must win.
    const [result] = matchMembers(
      ["Ada"],
      roster,
      [{ id: "c1", incorrect_text: "Ada", corrected_member_id: grace.id, frequency: 2, created_at: "" }],
    );
    expect(result.suggestedMember?.id).toBe(ada.id);
    expect(result.status).toBe("exact");
  });

  it("falls back to a learned correction when there is no exact match", () => {
    // "Adaa" has no exact match, so the correction applies. This is what the
    // previously misnamed "prefers learned corrections" case actually pins.
    const [result] = matchMembers(
      ["Adaa"],
      roster,
      [{ id: "c1", incorrect_text: "Adaa", corrected_member_id: ada.id, frequency: 2, created_at: "" }],
    );
    expect(result.suggestedMember?.id).toBe(ada.id);
    expect(result.status).toBe("correction");
  });

  it("falls through to a fuzzy match for a near miss", () => {
    const [result] = matchMembers(["Grace Hoppr"], roster, []);
    expect(result.suggestedMember?.id).toBe(grace.id);
    expect(result.status).toBe("fuzzy");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(1.0);
  });

  it("returns no match for an empty roster", () => {
    expect(matchMembers(["Unknown"], [], [])[0].status).toBe("none");
  });

  it("returns no match for text unrelated to the roster", () => {
    const [result] = matchMembers(["Zzzzz Qqqqq"], roster, []);
    expect(result.suggestedMember).toBeNull();
    expect(result.status).toBe("none");
  });

  it("tolerates a member with no aliases", () => {
    const [result] = matchMembers(["Ada Lovelace"], [grace], []);
    expect(result.status).toBe("none");
  });
});