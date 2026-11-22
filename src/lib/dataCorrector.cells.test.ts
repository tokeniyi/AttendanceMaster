import { describe, expect, it } from 'vitest';
import { correctCellText, validateDocument, validateRow } from './dataCorrector';

describe('correctCellText', () => {
  it('returns empty string for blank input', () => {
    expect(correctCellText('')).toBe('');
    expect(correctCellText('   ')).toBe('');
  });

  it('strips surrounding table-border noise', () => {
    expect(correctCellText('| John |', 'name')).toBe('John');
    expect(correctCellText('[x].', 'status')).toBe('X');
  });

  it('repairs letter/digit confusion in numeric columns', () => {
    expect(correctCellText('1O5', 'numeric')).toBe('105');
    expect(correctCellText('1,2S0', 'numeric')).toBe('1250');
    expect(correctCellText('abc', 'numeric')).toBe('abc'); // nothing numeric: keep original
  });

  it('title-cases names and replaces pipe with I', () => {
    expect(correctCellText('jOHN smith', 'name')).toBe('John Smith');
    expect(correctCellText('SM|TH', 'name')).toBe('Smith');
  });

  it('maps status words to attendance markers', () => {
    expect(correctCellText('present', 'status')).toBe('P');
    expect(correctCellText('Absent', 'status')).toBe('A');
    expect(correctCellText('wfh', 'status')).toBe('WFH');
    expect(correctCellText('xx', 'status')).toBe('XX');
  });

  it('keeps only digits and dots for serial numbers', () => {
    expect(correctCellText('l2.', 'serial')).toBe('12');
    expect(correctCellText('O7', 'serial')).toBe('07');
  });
});

describe('validateRow', () => {
  it('pads short rows and reports the issue', () => {
    const r = validateRow(['1', 'Ann'], 3);
    expect(r.correctedColumns).toHaveLength(3);
    expect(r.isValid).toBe(false);
    expect(r.issues[0]).toMatch(/Missing 1/);
  });

  it('merges excess columns into the last one', () => {
    const r = validateRow(['1', 'Ann', 'Lee', 'P'], 3, ['serial', 'name', 'name']);
    expect(r.correctedColumns).toHaveLength(3);
    expect(r.correctedColumns[2]).toBe('Lee P');
    expect(r.issues[0]).toMatch(/Extra 1/);
  });

  it('flags separator/noise rows', () => {
    const r = validateRow(['|', '.', ''], 3);
    expect(r.isValid).toBe(false);
    expect(r.issues.some(i => /noise/.test(i))).toBe(true);
  });

  it('accepts a clean row', () => {
    expect(validateRow(['1', 'Ann Lee', 'P'], 3, ['serial', 'name', 'status']).isValid).toBe(true);
  });
});

describe('validateDocument', () => {
  const row = (n: number, isHeader = false) => ({ columns: Array(n).fill('x'), isHeader });

  it('is low-quality and consistent for an empty / header-only document', () => {
    expect(validateDocument([])).toEqual({
      consistentColCount: true, dominantColCount: 0, outlierRowIndices: [], overallQuality: 'low',
    });
    expect(validateDocument([row(2, true)]).overallQuality).toBe('low');
  });

  it('is high quality when every data row has the same width', () => {
    const v = validateDocument([row(5, true), row(3), row(3), row(3)]);
    expect(v).toMatchObject({ dominantColCount: 3, outlierRowIndices: [], overallQuality: 'high', consistentColCount: true });
  });

  it('reports outlier indices relative to data rows (headers excluded)', () => {
    const v = validateDocument([row(9, true), row(3), row(2), row(3), row(3)]);
    expect(v.outlierRowIndices).toEqual([1]);
  });

  it('grades by outlier ratio: medium under 30%, low at or above', () => {
    const medium = validateDocument([row(3), row(3), row(3), row(3), row(2)]); // 20%
    expect(medium.overallQuality).toBe('medium');
    expect(medium.consistentColCount).toBe(false); // >= 15%
    const low = validateDocument([row(3), row(3), row(2), row(2), row(4)]); // 60%
    expect(low.overallQuality).toBe('low');
  });
});
