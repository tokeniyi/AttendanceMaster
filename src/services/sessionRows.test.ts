import { describe, expect, it } from "vitest";
import { matchMembers } from "@/matching/matchEngine";
import { bulkApprovableRows, mergeMatchedRow, mergeMatchedRows } from "./sessionRows";
import type { OCRLine } from "@/OCR/ocrService";
import type { Member } from "@/types";

const member: Member = { id: "m1", full_name: "Ada Lovelace", aliases: ["Ada"], created_at: "" };

function line(over: Partial<OCRLine> = {}): OCRLine {
  return {
    text: "Ada Lovelace",
    columns: ["1", "Ada Lovelace", "Present"],
    confidence: 88,
    structuralConfidence: { row: 95, column: 90, total: 91 },
    isHeader: false,
    rowIndex: 0,
    region: "data",
    semanticConfidence: 70,
    explanation: "Default data row classification",
    bbox: { x0: 0, y0: 10, x1: 100, y1: 30 },
    ...over,
  };
}

describe("mergeMatchedRow", () => {
  it("preserves the semantic fields the analyser produced", () => {
    const [match] = matchMembers(["Ada Lovelace"], [member], []);
    const merged = mergeMatchedRow(match, line());

    expect(merged.region).toBe("data");
    expect(merged.semanticConfidence).toBe(70);
    expect(merged.explanation).toBe("Default data row classification");
  });

  it("preserves the geometric fields the pipeline produced", () => {
    const [match] = matchMembers(["Ada Lovelace"], [member], []);
    const merged = mergeMatchedRow(match, line());

    expect(merged.columns).toEqual(["1", "Ada Lovelace", "Present"]);
    expect(merged.emptyCells).toBeUndefined();
    expect(merged.bbox).toEqual({ x0: 0, y0: 10, x1: 100, y1: 30 });
    expect(merged.rowIndex).toBe(0);
  });

  it("keeps match confidence and OCR confidence in separate fields", () => {
    const [match] = matchMembers(["Ada Lovelace"], [member], []);
    expect(match.confidence).toBe(1.0);

    const merged = mergeMatchedRow(match, line({ confidence: 42 }));
    // The matcher's score must not be overwritten by the OCR score.
    expect(merged.confidence).toBe(1.0);
    expect(merged.ocrConfidence).toBe(42);
  });

  it("keeps the matcher's identity fields intact", () => {
    const [match] = matchMembers(["Ada Lovelace"], [member], []);
    const merged = mergeMatchedRow(match, line());

    expect(merged.ocrName).toBe("Ada Lovelace");
    expect(merged.suggestedMember?.id).toBe("m1");
    expect(merged.status).toBe("exact");
  });
});

describe("mergeMatchedRows", () => {
  it("merges by index, so row i keeps the OCR line it came from", () => {
    const matches = matchMembers(["Ada Lovelace", "Unknown Person"], [member], []);
    const merged = mergeMatchedRows(matches, [
      line({ rowIndex: 0, region: "data" }),
      line({ rowIndex: 1, region: "footer", explanation: "Summary row in footer region" }),
    ]);

    expect(merged[0].region).toBe("data");
    expect(merged[1].region).toBe("footer");
    expect(merged[1].suggestedMember).toBeNull();
  });
});

describe("bulkApprovableRows", () => {
  it("returns data rows — this is what 'Approve All Data' acts on", () => {
    const rows = mergeMatchedRows(matchMembers(["Ada Lovelace"], [member], []), [line()]);
    expect(bulkApprovableRows(rows)).toHaveLength(1);
  });

  it("excludes title, header, metadata and footer rows", () => {
    const regions = ["title", "header", "metadata", "footer", "empty"] as const;
    const rows = regions.map((region, i) => mergeMatchedRow(
      { ocrName: region, suggestedMember: member, confidence: 1, status: "exact" },
      line({ region, rowIndex: i })
    ));

    expect(bulkApprovableRows(rows)).toHaveLength(0);
  });

  it("returns nothing when region was never set (the pre-fix state)", () => {
    // Regression guard for the original bug: before the fix, `region` was dropped
    // before persistence, so the button's filter matched zero rows and the button
    // was a silent no-op that still looked shipped.
    const matches = matchMembers(["Ada Lovelace"], [member], []);
    const stripped = matches.map(m => ({ ...m, ocrName: m.ocrName, suggestedMember: m.suggestedMember, status: m.status, confidence: m.confidence }));

    expect(bulkApprovableRows(stripped)).toHaveLength(0);
  });
});
