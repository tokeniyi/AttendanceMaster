import { describe, expect, it } from "vitest";
import { approvalRows, canFinalize, reviewProgress } from "./approval";

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

describe("reviewProgress", () => {
  it("counts only member-bearing non-header rows as eligible", () => {
    const rows = [
      { ocrName: "Name", suggestedMember: member, confidence: 1, status: "exact", isHeader: true },
      { ocrName: "Ada", suggestedMember: member, confidence: 1, status: "approved" },
      { ocrName: "Grace", suggestedMember: member, confidence: 0.6, status: "fuzzy" },
      { ocrName: "Unknown", suggestedMember: null, confidence: 0, status: "none" },
    ] as any;
    expect(reviewProgress(rows)).toMatchObject({ eligible: 2, approved: 1, flagged: 0, unresolved: 1 });
  });

  it("treats an empty table as complete with 100% progress, not NaN", () => {
    const p = reviewProgress([]);
    expect(p).toMatchObject({ eligible: 0, unresolved: 0, progressPct: 100, complete: true });
    expect(p.progressPct).not.toBeNaN();
  });

  it("counts a flagged row as decided, not as unresolved", () => {
    const rows = [{ ocrName: "Bad", suggestedMember: member, confidence: 0.5, status: "flagged" }] as any;
    expect(reviewProgress(rows)).toMatchObject({ eligible: 1, flagged: 1, unresolved: 0, complete: true });
  });

  it("does not count memberless unresolved rows against progress", () => {
    const rows = [
      { ocrName: "Ada", suggestedMember: member, confidence: 1, status: "approved" },
      { ocrName: "Unknown", suggestedMember: null, confidence: 0, status: "none" },
    ] as any;
    expect(reviewProgress(rows)).toMatchObject({ eligible: 1, unresolved: 0, complete: true });
  });
});

describe("canFinalize", () => {
  it("refuses while any member-bearing row is unreviewed", () => {
    // This is the silent data-corruption case: the row carries a member but no
    // operator decision, so approving would write present = TRUE unearned.
    const rows = [
      { ocrName: "Ada", suggestedMember: member, confidence: 1, status: "approved" },
      { ocrName: "Grace", suggestedMember: member, confidence: 0.65, status: "fuzzy" },
    ] as any;
    expect(canFinalize(rows)).toBe(false);
  });

  it("allows finalizing when every member-bearing row is approved or flagged", () => {
    const rows = [
      { ocrName: "Ada", suggestedMember: member, confidence: 1, status: "approved" },
      { ocrName: "Bad", suggestedMember: member, confidence: 0.5, status: "flagged" },
    ] as any;
    expect(canFinalize(rows)).toBe(true);
  });

  it("does not deadlock on a table with no matchable rows", () => {
    const rows = [
      { ocrName: "Name", suggestedMember: member, confidence: 1, status: "exact", isHeader: true },
      { ocrName: "Unknown", suggestedMember: null, confidence: 0, status: "none" },
    ] as any;
    expect(canFinalize(rows)).toBe(true);
  });
});
