import { describe, expect, it } from "vitest";
import {
  computeDataQualityIndex,
  HIGH_CONFIDENCE_THRESHOLD,
} from "./analytics";

describe("computeDataQualityIndex", () => {
  it("returns 0 for an empty table (regression: NaN on empty final_table)", () => {
    expect(computeDataQualityIndex([])).toBe(0);
  });

  it("returns 100 when every row is above the confidence threshold", () => {
    expect(
      computeDataQualityIndex([
        { ocrConfidence: HIGH_CONFIDENCE_THRESHOLD + 1 },
        { ocrConfidence: HIGH_CONFIDENCE_THRESHOLD + 10 },
      ])
    ).toBe(100);
  });

  it("returns 0 when every row is below the confidence threshold", () => {
    expect(
      computeDataQualityIndex([
        { ocrConfidence: HIGH_CONFIDENCE_THRESHOLD - 1 },
        { ocrConfidence: 0 },
      ])
    ).toBe(0);
  });

  it("returns the rounded percentage of high-confidence rows", () => {
    expect(
      computeDataQualityIndex([
        { ocrConfidence: 90 },
        { ocrConfidence: 50 },
        { ocrConfidence: 95 },
        { ocrConfidence: 60 },
      ])
    ).toBe(50);
  });

  it("treats a missing ocrConfidence as 0", () => {
    expect(
      computeDataQualityIndex([
        {},
        { ocrConfidence: 90 },
      ])
    ).toBe(50);
  });
});
