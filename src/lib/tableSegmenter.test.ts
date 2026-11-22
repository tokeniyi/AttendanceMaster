import { describe, it, expect } from 'vitest';
import { detectRulingLines, eraseRulingLines } from './tableSegmenter';
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


describe('detectRulingLines', () => {
  // 40x30 image: horizontal rules at y=5 and y=20 (2px thick), vertical rule at x=10.
  const w = 40, h = 30;
  const make = () => {
    const bin = new Uint8Array(w * h);
    for (const y of [5, 6, 20, 21]) for (let x = 0; x < w; x++) bin[y * w + x] = 1;
    for (let y = 0; y < h; y++) bin[y * w + 10] = 1;
    // Short text-like blob that must NOT count as a rule.
    for (let x = 20; x < 26; x++) bin[12 * w + x] = 1;
    return bin;
  };

  it('finds thick rules as single centred lines and ignores short text runs', () => {
    const lines = detectRulingLines(make(), w, h);
    expect(lines.rows).toEqual([6, 21]);
    expect(lines.cols).toEqual([10]);
  });

  it('erases rules but keeps text pixels', () => {
    const bin = make();
    eraseRulingLines(bin, w, h, detectRulingLines(bin, w, h));
    expect(bin[5 * w + 30]).toBe(0);
    expect(bin[15 * w + 10]).toBe(0);
    expect(bin[12 * w + 22]).toBe(1);
  });
});
