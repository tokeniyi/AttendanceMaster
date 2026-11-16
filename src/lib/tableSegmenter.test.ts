import { describe, it, expect } from 'vitest';
import { findBoundaries } from './tableSegmenter';

describe('findBoundaries', () => {
  it('returns only the outer edges for an empty profile', () => {
    expect(findBoundaries(new Float32Array(0), 0, 0.1, 3)).toEqual([0, -1]);
  });

  it('places a separator in the middle of a gap between two bands', () => {
    // content 0-4, gap 5-9, content 10-14
    const proj = new Float32Array(15);
    for (let i = 0; i < 15; i++) proj[i] = i >= 5 && i <= 9 ? 0 : 1;
    expect(findBoundaries(proj, 15, 0.1, 3)).toEqual([0, 8, 14]);
  });

  it('ignores gaps narrower than minGap', () => {
    const proj = new Float32Array(10).fill(1);
    proj[4] = 0;
    proj[5] = 0;
    expect(findBoundaries(proj, 10, 0.1, 3)).toEqual([0, 9]);
  });

  it('does not emit a separator for a trailing gap', () => {
    const proj = new Float32Array(10).fill(1);
    for (let i = 6; i < 10; i++) proj[i] = 0;
    expect(findBoundaries(proj, 10, 0.1, 2)).toEqual([0, 9]);
  });
});
