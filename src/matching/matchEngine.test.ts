import { describe, expect, it } from "vitest";
import { matchMembers } from "./matchEngine";

const member = { id: "m1", full_name: "Ada Lovelace", aliases: ["Ada"], created_at: "" };

describe("matchMembers", () => {
  it("prefers learned corrections", () => {
    const [result] = matchMembers(["Adaa"], [member], [{ id: "c1", incorrect_text: "Adaa", corrected_member_id: "m1", frequency: 2, created_at: "" }]);
    expect(result.suggestedMember?.id).toBe("m1");
    expect(result.status).toBe("correction");
  });

  it("returns no match for an empty roster", () => {
    expect(matchMembers(["Unknown"], [], [])[0].status).toBe("none");
  });
});
