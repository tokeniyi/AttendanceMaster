import { describe, expect, it } from "vitest";
import { matchMembers } from "./matchEngine";

const member = { id: "m1", full_name: "Ada Lovelace", aliases: ["Ada"], created_at: "" };
const memberWithUuid = { 
  id: "550e8400-e29b-41d4-a716-446655440000", 
  full_name: "Test User", 
  aliases: ["Test"], 
  created_at: "" 
};

describe("matchMembers", () => {
  it("prefers learned corrections", () => {
    const [result] = matchMembers(["Adaa"], [member], [{ id: "c1", incorrect_text: "Adaa", corrected_member_id: "m1", frequency: 2, created_at: "" }]);
    expect(result.suggestedMember?.id).toBe("m1");
    expect(result.status).toBe("correction");
  });

  it("returns no match for an empty roster", () => {
    expect(matchMembers(["Unknown"], [], [])[0].status).toBe("none");
  });

  // Regression test for P0 #1: UUID substring matching
  it("does not match single-character OCR artifacts against UUIDs", () => {
    const [result] = matchMembers(["a"], [memberWithUuid], []);
    expect(result.status).toBe("none");
    expect(result.suggestedMember).toBeNull();
  });

  it("does not match two-character OCR artifacts against UUIDs", () => {
    const [result] = matchMembers(["55"], [memberWithUuid], []);
    expect(result.status).toBe("none");
    expect(result.suggestedMember).toBeNull();
  });

  it("does not match partial UUID fragments (dashes, digits)", () => {
    const [result] = matchMembers(["-"], [memberWithUuid], []);
    expect(result.status).toBe("none");
    expect(result.suggestedMember).toBeNull();
  });

  it("matches full UUID when provided as exact ID", () => {
    const [result] = matchMembers(["550e8400-e29b-41d4-a716-446655440000"], [memberWithUuid], []);
    expect(result.status).toBe("exact");
    expect(result.suggestedMember?.id).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  // Regression test for P0 #12: exact-over-correction precedence
  it("prefers exact name match over learned correction when both apply", () => {
    const correctionMember = { 
      id: "m2", 
      full_name: "Ada Lovelace",  // Same name as member
      aliases: [], 
      created_at: "" 
    };
    const [result] = matchMembers(
      ["Ada Lovelace"], 
      [member, correctionMember], 
      [{ id: "c1", incorrect_text: "Ada Lovelace", corrected_member_id: "m2", frequency: 5, created_at: "" }]
    );
    // Should match the first member by exact name, not the correction
    expect(result.status).toBe("exact");
    expect(result.suggestedMember?.id).toBe("m1");
  });
});
