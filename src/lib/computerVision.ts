/**
 * Lightweight Computer Vision Core
 * Implements Morphology, Binarization, and Connected Component Analysis (CCA)
 * optimized for zero-lag browser execution without heavy WASM dependencies like OpenCV.
 */

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
}

export interface CellAnalysis {
  isEmpty: boolean;
  fgRatio: number;
  ccCount: number;
  reason?: string;
}

/**
 * Converts ImageData to a binary Uint8Array where 1 = foreground (dark ink), 0 = background (white)
 * Handles inverted images (dark background, light text) automatically via Otsu-like heuristic
 * or simple thresholding.
 */
export function binarize(imageData: ImageData, isInverted = false): Uint8Array {
  const { width, height, data } = imageData;
  const size = width * height;
  const bin = new Uint8Array(size);

  // Simple grayscale + threshold
  const THRESH = isInverted ? 100 : 160;
  
  for (let i = 0; i < size; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    
    if (isInverted) {
      bin[i] = gray > THRESH ? 1 : 0; // light pixel = fg
    } else {
      bin[i] = gray < THRESH ? 1 : 0; // dark pixel = fg
    }
  }
  return bin;
}

/**
 * Connected Component Analysis (Fast 2-pass)
 * Finds isolated islands of pixels (text, lines, noise).
 */
export function connectedComponents(bin: Uint8Array, w: number, h: number): BoundingBox[] {
  const labels = new Int32Array(w * h);
  let nextLabel = 1;
  const linked = new Map<number, number>();

  const find = (i: number): number => {
    while (linked.get(i) !== i) {
      i = linked.get(i)!;
    }
    return i;
  };

  const union = (i: number, j: number) => {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) {
      if (rootI < rootJ) linked.set(rootJ, rootI);
      else linked.set(rootI, rootJ);
    }
  };

  // Pass 1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bin[y * w + x] === 1) {
        const up = y > 0 ? labels[(y - 1) * w + x] : 0;
        const left = x > 0 ? labels[y * w + (x - 1)] : 0;

        if (up === 0 && left === 0) {
          labels[y * w + x] = nextLabel;
          linked.set(nextLabel, nextLabel);
          nextLabel++;
        } else if (up !== 0 && left === 0) {
          labels[y * w + x] = up;
        } else if (left !== 0 && up === 0) {
          labels[y * w + x] = left;
        } else {
          labels[y * w + x] = up; // default to up
          union(up, left);
        }
      }
    }
  }

  // Pass 2: resolve roots and build bounding boxes
  const boxes = new Map<number, { minX: number, minY: number, maxX: number, maxY: number, area: number }>();
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bin[y * w + x] === 1) {
        const label = find(labels[y * w + x]);
        
        let box = boxes.get(label);
        if (!box) {
          box = { minX: x, minY: y, maxX: x, maxY: y, area: 0 };
          boxes.set(label, box);
        }
        
        box.minX = Math.min(box.minX, x);
        box.maxX = Math.max(box.maxX, x);
        box.minY = Math.min(box.minY, y);
        box.maxY = Math.max(box.maxY, y);
        box.area++;
      }
    }
  }

  return Array.from(boxes.values()).map(b => ({
    x: b.minX,
    y: b.minY,
    w: b.maxX - b.minX + 1,
    h: b.maxY - b.minY + 1,
    area: b.area
  }));
}

/**
 * Analyzes a cell's pixel density and connected components to determine 
 * if it's genuinely empty or just contains noise/borders.
 * THIS SUPPRESSES HALLUCINATIONS LIKE "I", "E", "oo".
 */
export function analyzeCellDensity(bin: Uint8Array, w: number, h: number): CellAnalysis {
  let fgPixels = 0;
  for (let i = 0; i < bin.length; i++) {
    if (bin[i] === 1) fgPixels++;
  }

  const fgRatio = fgPixels / (w * h);

  // If literally almost no pixels, it's empty
  if (fgRatio < 0.005) {
    return { isEmpty: true, fgRatio, ccCount: 0, reason: 'Zero ink detected' };
  }

  // Find components
  const ccs = connectedComponents(bin, w, h);
  
  // Filter out tiny dust noise (area < 5px) or huge border lines
  // Text characters usually have reasonable area (15px to 500px) and aspect ratios
  const validTextCCs = ccs.filter(cc => {
    // Too small = dust
    if (cc.area < 8) return false;
    
    // Too long/tall = likely a border line that got included in the crop
    const aspect = cc.w / cc.h;
    if (aspect > 10 || aspect < 0.1) return false;

    // Check if it's touching the absolute edges (likely a cropped border line)
    if (cc.x <= 2 || cc.y <= 2 || (cc.x + cc.w) >= w - 2 || (cc.y + cc.h) >= h - 2) {
       // If it spans almost the whole width or height, it's a border
       if (cc.w > w * 0.8 || cc.h > h * 0.8) return false;
    }

    return true;
  });

  if (validTextCCs.length === 0) {
    return { isEmpty: true, fgRatio, ccCount: ccs.length, reason: 'Only noise or borders detected' };
  }

  return { isEmpty: false, fgRatio, ccCount: validTextCCs.length };
}

/**
 * Morphological Dilation (expands foreground)
 * Useful for connecting dashed lines or fragmented text into blocks.
 */
export function dilate(bin: Uint8Array, w: number, h: number, kx: number, ky: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const rx = Math.floor(kx / 2);
  const ry = Math.floor(ky / 2);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bin[y * w + x] === 1) {
        // Expand
        for (let dy = -ry; dy <= ry; dy++) {
          for (let dx = -rx; dx <= rx; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
              out[ny * w + nx] = 1;
            }
          }
        }
      }
    }
  }
  return out;
}

/**
 * Morphological Erosion (shrinks foreground)
 * Useful for stripping away noise.
 */
export function erode(bin: Uint8Array, w: number, h: number, kx: number, ky: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const rx = Math.floor(kx / 2);
  const ry = Math.floor(ky / 2);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let keep = true;
      for (let dy = -ry; dy <= ry; dy++) {
        for (let dx = -rx; dx <= rx; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || ny >= h || nx < 0 || nx >= w || bin[ny * w + nx] === 0) {
            keep = false;
            break;
          }
        }
        if (!keep) break;
      }
      if (keep) out[y * w + x] = 1;
    }
  }
  return out;
}
