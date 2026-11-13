import { describe, it, expect } from "vitest";
import { toSafeCSV, sanitizeMemberRows } from "./csvService";

describe("toSafeCSV", () => {
  it("neutralises cells that would run as spreadsheet formulas", () => {
    const csv = toSafeCSV([{ A: "=HYPERLINK(\"http://x\")", B: "+1", C: "-2", D: "@SUM(A1)" }], { header: false });
    const cells = csv.split(",");
    expect(cells.every(c => c.replace(/^"/, "").startsWith("'"))).toBe(true);
  });

  it("leaves ordinary text untouched", () => {
    expect(toSafeCSV([{ A: "John Doe", B: "12" }], { header: false })).toBe("John Doe,12");
  });

  it("respects the header option", () => {
    expect(toSafeCSV([{ A: "x" }])).toBe("A\r\nx");
    expect(toSafeCSV([{ A: "x" }], { header: false })).toBe("x");
  });
});

describe("sanitizeMemberRows", () => {
  it("keeps only known columns, trims, and splits aliases", () => {
    const rows = sanitizeMemberRows([
      { full_name: "  Ada Obi ", aliases: "Ada; A. Obi |", department: " Drama ", email: "", id: "evil", owner_id: "x" },
    ]);
    expect(rows).toEqual([{ full_name: "Ada Obi", aliases: ["Ada", "A. Obi"], department: "Drama" }]);
  });

  it("skips rows without a name", () => {
    expect(sanitizeMemberRows([{ full_name: "  " }, { email: "a@b.c" }, { full_name: "Bo" }])).toEqual([
      { full_name: "Bo", aliases: [] },
    ]);
  });
});
