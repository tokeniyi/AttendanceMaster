import { describe, it, expect } from 'vitest';
import { formatConfidence, getStatusColor } from './utils';

describe('formatConfidence', () => {
  it('formats a normal score', () => {
    expect(formatConfidence(0.876)).toBe('88%');
  });
  it('clamps out-of-range scores', () => {
    expect(formatConfidence(1.4)).toBe('100%');
    expect(formatConfidence(-0.2)).toBe('0%');
  });
  it('never renders NaN or Infinity', () => {
    expect(formatConfidence(NaN)).toBe('0%');
    expect(formatConfidence(Infinity)).toBe('0%');
  });
});

describe('getStatusColor', () => {
  it('falls back to slate for unknown statuses', () => {
    expect(getStatusColor('weird')).toContain('slate');
  });
  it('uses emerald for exact and approved', () => {
    expect(getStatusColor('exact')).toContain('emerald');
    expect(getStatusColor('approved')).toContain('emerald');
  });
});
