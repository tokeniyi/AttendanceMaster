import { describe, expect, it } from "vitest";
import { approvalRows } from "./approval";

const member = { id: "m1", full_name: "Ada Lovelace", aliases: [], created_at: "" };

describe("approvalRows", () => {
  it("excludes headers and unmatched rows", () => {
    const rows = [
      { ocrName: "Name", suggestedMember: member, confidence: 1, status: "exact", isHeader: true },
      { ocrName: "Ada", suggestedMember: member, confidence: 1, status: "approved" },
      { ocrName: "Unknown", suggestedMember: null, confidence: 0, status: "none" },
    ] as const;
    expect(approvalRows([...rows] as any)).toHaveLength(1);
  });
});
