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
// Longer names, included so the length gate is exercised against realistic
// full_name lengths rather than only the short "Ada Lovelace" case.
const chinelo = {
  id: "bbbb1111-2222-4333-8444-555566667777",
  full_name: "Chinelo Okonkwo",
  aliases: ["Chinelo"],
  created_at: "",
};
const marcus = {
  id: "cccc1111-2222-4333-8444-555566668888",
  full_name: "Marcus Vandenberghe",
  aliases: [],
  created_at: "",
};
const roster = [ada, grace, chinelo, marcus];

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

  // --- P0 #4 (fuzzy half): short OCR fragments must not become a suggestion ---
  describe("fuzzy matching is length-gated, not confidence-gated", () => {
    // PR #6 anchored the *exact* id path, but the fuzzy path remained open: with
    // threshold 0.35 Fuse scores a 1-2 char artifact against a long full_name at
    // 0.967-0.996 — HIGHER than a genuinely misread real name ("Grace Hoppr",
    // 0.695). Every one of these resolved to a person at status "fuzzy", flowed
    // into suggested_table, and was written by approve_session as a wrong-person
    // attendance row.
    it.each([
      "a", "A", "d", "e", "n",          // single characters
      "Ad", "Gr", "Ma", "Ch", "Lo", "Ok", "Va", "gh",  // two characters
    ])("never suggests a member for the junk fragment %j", (fragment) => {
      const [result] = matchMembers([fragment], roster, []);
      expect(result.suggestedMember).toBeNull();
      expect(result.status).toBe("none");
      expect(result.confidence).toBe(0);
    });

    // The threshold is chosen on evidence, so pin the boundary it was chosen
    // from: everything the gate must reject, and everything it must not.
    it("rejects at length 2 and below but accepts a 3-character real name", () => {
      // 3 characters is the first length at which a legitimate short name must
      // still reach the roster.
      expect(matchMembers(["Ad"], roster, [])[0].suggestedMember).toBeNull();
      expect(matchMembers(["Ad"], roster, [])[0].status).toBe("none");
      expect(matchMembers(["Ada"], roster, [])[0].suggestedMember?.id).toBe(ada.id);
    });

    // A floor would be the wrong instrument: these are REAL names carrying real
    // OCR damage, and they must survive. Note the two classes here. Names with
    // internal character damage score LOW (0.588-0.760); truncations score
    // HIGH (0.967) because dropping a trailing character genuinely is close.
    // The low-scoring group is what makes a confidence floor unusable: to drop
    // the junk (0.967-0.996) a floor must sit above 0.967, which would discard
    // every one of the damaged-but-real names below.
    it.each([
      ["Ada Lovclacc", ada.id],
      ["Grace Hoppr", grace.id],
      ["Grace Hopprr", grace.id],
      ["Chinelo Okonkw", chinelo.id],
      ["Marcus Vandenberg", marcus.id],
      ["ada lovelacc", ada.id],
      ["Marcus Van Den Berghe", marcus.id],
    ])("still matches the genuinely misread name %j", (noisy, expectedId) => {
      const [result] = matchMembers([noisy], roster, []);
      expect(result.suggestedMember?.id).toBe(expectedId);
      expect(result.status).toBe("fuzzy");
      // No fuzzy suggestion is ever presented as certain, whatever the damage.
      expect(result.confidence).toBeLessThan(1.0);
      expect(result.confidence).toBeGreaterThan(0);
    });

    // Pins the evidence that a `minConfidence` floor is the wrong instrument.
    // Character-damaged but CORRECT matches score 0.588-0.760, while 1-2
    // character junk fragments were measured at 0.9672-0.9959 before this gate
    // existed. The damaged-correct matches score strictly BELOW the junk did, so
    // any floor positioned to reject that junk also discards these real rows.
    // Truncations such as "Chinelo Okonkw" are excluded: dropping a trailing
    // character genuinely is a close match and scores high for real reasons.
    it("scores correct damaged matches below the pre-fix junk score", () => {
      const JUNK_SCORE_BEFORE_THIS_FIX = 0.9672;
      const damaged = matchMembers(
        ["Ada Lovclacc", "Grace Hoppr", "Grace Hopprr", "ada lovelacc"],
        roster,
        [],
      );
      for (const r of damaged) {
        expect(r.status).toBe("fuzzy");
        expect(r.confidence).toBeLessThan(JUNK_SCORE_BEFORE_THIS_FIX);
      }
    });

    // Short-but-real names must not be collateral damage of the gate.
    it.each([["Adaa", ada.id], ["Grah", grace.id], ["Hoppr", grace.id], ["Ada L", ada.id]])(
      "still matches the short but real name %j",
      (short, expectedId) => {
        const [result] = matchMembers([short], roster, []);
        expect(result.suggestedMember?.id).toBe(expectedId);
        expect(result.status).toBe("fuzzy");
      },
    );

    // The gate belongs to the fuzzy path only. An exact alias match is a
    // deliberate, authoritative decision and must still win below the gate.
    it("does not affect exact name or alias matches", () => {
      expect(matchMembers(["ada"], roster, [])[0].status).toBe("exact");
      expect(matchMembers(["ada"], roster, [])[0].suggestedMember?.id).toBe(ada.id);
    });

    // A learned correction is likewise an explicit, human-supplied mapping.
    it("does not affect learned corrections for short text", () => {
      const [result] = matchMembers(
        ["Ad"],
        roster,
        [{ id: "c1", incorrect_text: "Ad", corrected_member_id: ada.id, frequency: 2, created_at: "" }],
      );
      expect(result.status).toBe("correction");
      expect(result.suggestedMember?.id).toBe(ada.id);
    });
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