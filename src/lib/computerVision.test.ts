import { describe, it, expect } from 'vitest';
import { detectInverted, binarize } from './computerVision';

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
