/**
 * Image Preprocessing Pipeline for Production-Grade OCR.
 * Uses Canvas API to enhance images before Tesseract ingestion.
 */

export interface PreprocessingOptions {
  contrast?: number; // -1 to 1
  brightness?: number; // -1 to 1
  threshold?: number; // 0 to 255 (null for adaptive)
  grayscale?: boolean;
  sharpen?: boolean;
}

export async function preprocessImage(
  source: string | File | Blob, 
  options: PreprocessingOptions = {}
): Promise<string> {
  const img = await loadImage(source);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  if (!ctx) throw new Error("Could not initialize canvas context");

  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // 1. Grayscale & Contrast/Brightness
  const contrast = (options.contrast || 0) + 1; // [0, 2]
  const brightness = (options.brightness || 0) * 255; // [-255, 255]

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // Grayscale (Luminance)
    if (options.grayscale !== false) {
      const v = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = g = b = v;
    }

    // Brightness
    r += brightness;
    g += brightness;
    b += brightness;

    // Contrast
    r = (r - 128) * contrast + 128;
    g = (g - 128) * contrast + 128;
    b = (b - 128) * contrast + 128;

    data[i] = clamp(r);
    data[i + 1] = clamp(g);
    data[i + 2] = clamp(b);
  }

  // 2. Simple Thresholding (if specified)
  if (options.threshold !== undefined) {
    const t = options.threshold;
    for (let i = 0; i < data.length; i += 4) {
      const v = (data[i] > t) ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  
  // 3. Simple Sharpening (Convolution)
  if (options.sharpen) {
    sharpen(ctx, canvas.width, canvas.height);
  }

  return canvas.toDataURL('image/png');
}

function loadImage(source: string | File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    if (source instanceof File || source instanceof Blob) {
      img.src = URL.createObjectURL(source);
    } else {
      img.src = source;
    }
  });
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, v));
}

function sharpen(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const weights = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  const side = Math.round(Math.sqrt(weights.length));
  const halfSide = Math.floor(side / 2);
  const src = ctx.getImageData(0, 0, w, h);
  const sw = src.width;
  const sh = src.height;
  const srcData = src.data;
  const dst = ctx.createImageData(w, h);
  const dstData = dst.data;

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const sy = y;
      const sx = x;
      const dstOff = (y * sw + x) * 4;
      let r = 0, g = 0, b = 0;
      for (let cy = 0; cy < side; cy++) {
        for (let cx = 0; cx < side; cx++) {
          const scy = sy + cy - halfSide;
          const scx = sx + cx - halfSide;
          if (scy >= 0 && scy < sh && scx >= 0 && scx < sw) {
            const srcOff = (scy * sw + scx) * 4;
            const wt = weights[cy * side + cx];
            r += srcData[srcOff] * wt;
            g += srcData[srcOff + 1] * wt;
            b += srcData[srcOff + 2] * wt;
          }
        }
      }
      dstData[dstOff] = clamp(r);
      dstData[dstOff + 1] = clamp(g);
      dstData[dstOff + 2] = clamp(b);
      dstData[dstOff + 3] = 255;
    }
  }
  ctx.putImageData(dst, 0, 0);
}
