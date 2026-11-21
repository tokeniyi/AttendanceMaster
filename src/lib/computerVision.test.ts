import { describe, it, expect } from 'vitest';
import {
  detectInverted,
  binarize,
  connectedComponents,
  analyzeCellDensity,
  dilate,
  erode,
} from './computerVision';

function img(w: number, h: number, fn: (x: number, y: number) => number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = fn(x, y);
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data } as unknown as ImageData;
}

describe('detectInverted', () => {
  it('is false for a white page with dark ink', () => {
    expect(detectInverted(img(40, 40, (x) => (x % 10 === 0 ? 20 : 250)))).toBe(false);
  });
  it('is true for a dark page with light text', () => {
    expect(detectInverted(img(40, 40, (x) => (x % 10 === 0 ? 230 : 20)))).toBe(true);
  });
  it('is false for an empty image', () => {
    expect(detectInverted(img(0, 0, () => 0))).toBe(false);
  });
  it('binarize yields light-on-dark foreground when inverted', () => {
    const im = img(10, 1, (x) => (x < 3 ? 230 : 20));
    const bin = binarize(im, detectInverted(im));
    expect(Array.from(bin)).toEqual([1, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
  });
});

/** Build a w*h binary grid from rows of '#'/'.' characters. */
function grid(rows: string[]): { bin: Uint8Array; w: number; h: number } {
  const h = rows.length;
  const w = rows[0].length;
  const bin = new Uint8Array(w * h);
  rows.forEach((r, y) => [...r].forEach((c, x) => { bin[y * w + x] = c === '#' ? 1 : 0; }));
  return { bin, w, h };
}

describe('connectedComponents', () => {
  it('returns no boxes for an empty grid', () => {
    const { bin, w, h } = grid(['....', '....']);
    expect(connectedComponents(bin, w, h)).toEqual([]);
  });
  it('finds separate blobs with correct boxes and areas', () => {
    const { bin, w, h } = grid(['##...', '##..#', '....#']);
    const boxes = connectedComponents(bin, w, h).sort((a, b) => a.x - b.x);
    expect(boxes).toEqual([
      { x: 0, y: 0, w: 2, h: 2, area: 4 },
      { x: 4, y: 1, w: 1, h: 2, area: 2 },
    ]);
  });
  it('merges a U shape whose arms get different provisional labels', () => {
    const { bin, w, h } = grid(['#.#', '#.#', '###']);
    expect(connectedComponents(bin, w, h)).toEqual([{ x: 0, y: 0, w: 3, h: 3, area: 7 }]);
  });
  it('does not join diagonal neighbours (4-connectivity)', () => {
    const { bin, w, h } = grid(['#.', '.#']);
    expect(connectedComponents(bin, w, h)).toHaveLength(2);
  });
});

describe('analyzeCellDensity', () => {
  it('treats a blank cell as empty', () => {
    const { bin, w, h } = grid([''.padEnd(20, '.'), ...Array(19).fill(''.padEnd(20, '.'))]);
    const r = analyzeCellDensity(bin, w, h);
    expect(r.isEmpty).toBe(true);
    expect(r.ccCount).toBe(0);
  });
  it('treats a cell holding only a full-width border line as empty', () => {
    const rows = Array(20).fill(''.padEnd(20, '.'));
    rows[0] = ''.padEnd(20, '#');
    const { bin, w, h } = grid(rows);
    const r = analyzeCellDensity(bin, w, h);
    expect(r.isEmpty).toBe(true);
    expect(r.ccCount).toBe(1);
  });
  it('treats dust specks as empty', () => {
    const rows = Array(20).fill(''.padEnd(20, '.'));
    rows[10] = '.........###........';
    const { bin, w, h } = grid(rows);
    expect(analyzeCellDensity(bin, w, h).isEmpty).toBe(true);
  });
  it('detects a text-sized blob in the middle of the cell', () => {
    const rows = Array(20).fill(''.padEnd(20, '.'));
    for (let y = 6; y < 12; y++) rows[y] = '.......######.......';
    const { bin, w, h } = grid(rows);
    const r = analyzeCellDensity(bin, w, h);
    expect(r.isEmpty).toBe(false);
    expect(r.ccCount).toBe(1);
  });
});

describe('dilate / erode', () => {
  it('dilate grows a single pixel to the kernel size, clipped at edges', () => {
    const { bin, w, h } = grid(['.....', '..#..', '.....']);
    expect(Array.from(dilate(bin, w, h, 3, 3))).toEqual([
      0, 1, 1, 1, 0,
      0, 1, 1, 1, 0,
      0, 1, 1, 1, 0,
    ]);
    const corner = grid(['#..', '...']);
    expect(Array.from(dilate(corner.bin, corner.w, corner.h, 3, 3))).toEqual([1, 1, 0, 1, 1, 0]);
  });
  it('erode removes a lone pixel and shrinks a block, treating outside as background', () => {
    const lone = grid(['...', '.#.', '...']);
    expect(Array.from(erode(lone.bin, lone.w, lone.h, 3, 3))).toEqual(new Array(9).fill(0));
    const block = grid(['.....', '.###.', '.###.', '.###.', '.....']);
    const out = erode(block.bin, block.w, block.h, 3, 3);
    expect(Array.from(out).reduce((a, b) => a + b, 0)).toBe(1);
    expect(out[2 * 5 + 2]).toBe(1);
  });
});
