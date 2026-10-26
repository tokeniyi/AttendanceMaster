import { describe, expect, it } from "vitest";
import { isSerialLabel, inferColumnSchema } from "./semanticAnalyzer";
import { correctCellText } from "./dataCorrector";
import type { SemanticRow } from "./semanticAnalyzer";

const mkHeader = (columns: string[]): SemanticRow =>
  ({
    text: columns.join("  "),
    columns,
    region: "header",
    isHeader: true,
    confidence: 100,
    structuralConfidence: { row: 100, column: 100, total: 100 },
    emptyCells: [],
    rowIndex: 0,
    bbox: { x0: 0, y0: 0, x1: 100, y1: 10 },
    semanticConfidence: 90,
    explanation: "",
  }) as SemanticRow;

const mkData = (columns: string[], rowIndex: number): SemanticRow =>
  ({ ...mkHeader(columns), region: "data", isHeader: false, rowIndex }) as SemanticRow;

describe("isSerialLabel", () => {
  it("recognises real serial-number headers", () => {
    for (const label of ["#", "No", "No.", "no", "Sr.", "Sr", "Sno", "Sno.", "SN", "Sl No", "Sl.No", "Sr. No.", "Roll No", "Serial", "Serial No", "Number", "S/N"]) {
      expect(isSerialLabel(label), label).toBe(true);
    }
  });

  // Regression: the old unanchored /no\.?/ matched these, routing them to
  // normalizeSerial which strips every non-digit and empties the whole column.
  it("does not treat ordinary words containing 'no' as serial columns", () => {
    for (const label of ["Notes", "Nomination", "Notional", "Note", "North", "Normal", "Notice", "Phone", "Announce"]) {
      expect(isSerialLabel(label), label).toBe(false);
    }
  });

  it("does not treat ordinary words containing 'sr' as serial columns", () => {
    for (const label of ["Sr", "Senior", "Secretarial"]) {
      // "Sr" alone IS a serial header; the rest must not be.
      expect(isSerialLabel(label), label).toBe(label.toLowerCase() === "sr");
    }
  });

  it("ignores surrounding whitespace and casing", () => {
    expect(isSerialLabel("  NO.  ")).toBe(true);
    expect(isSerialLabel("SeRiAl")).toBe(true);
  });
});

describe("column-type inference does not destroy non-serial columns", () => {
  it("classifies a 'Notes' column as text, not serial", () => {
    const [schema] = inferColumnSchema(
      [mkHeader(["Notes", "Name"])],
      [mkData(["Approved on Monday", "Ada Lovelace"], 1)],
      2
    );
    expect(schema.inferredType).not.toBe("serial");
  });

  it("classifies 'Nomination' as text, not serial", () => {
    const [schema] = inferColumnSchema(
      [mkHeader(["Nomination"])],
      [mkData(["Staff"], 1)],
      1
    );
    expect(schema.inferredType).not.toBe("serial");
  });

  it("still classifies a genuine 'Sr. No' column as serial", () => {
    const [schema] = inferColumnSchema(
      [mkHeader(["Sr. No", "Name"])],
      [mkData(["1", "Ada Lovelace"], 1), mkData(["2", "Grace Hopper"], 2)],
      2
    );
    expect(schema.inferredType).toBe("serial");
  });
});

describe("a misclassified column destroys its data (the bug this prevents)", () => {
  it("normalizeSerial empties a word, proving why the header test must not over-match", () => {
    // If the header is wrongly typed 'serial', this is what the operator would see.
    expect(correctCellText("Approved", "serial")).toBe("");
    expect(correctCellText("Notes", "serial")).toBe("");
    expect(correctCellText("Monthly", "serial")).toBe("1");
    // And with the corrected header type, the value survives.
    expect(correctCellText("Approved", "text")).toBe("Approved");
  });

  it("keeps serial values intact when the column really is serial", () => {
    expect(correctCellText("12", "serial")).toBe("12");
    expect(correctCellText("l2", "serial")).toBe("12");
  });
});
