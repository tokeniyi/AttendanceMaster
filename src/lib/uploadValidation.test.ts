import { describe, expect, it } from "vitest";
import {
  FILE_TOO_LARGE_MESSAGE,
  MAX_FILE_BYTES,
  UNSUPPORTED_FORMAT_MESSAGE,
  validateUpload,
} from "./uploadValidation";

// validateUpload only reads `.type` and `.size`, so a structural stand-in is enough and
// keeps the suite on the existing `environment: "node"` config with no jsdom dependency.
const file = (type: string, size: number) => ({ type, size }) as File;

describe("validateUpload", () => {
  it("returns null for an accepted image", () => {
    expect(validateUpload(file("image/png", 1024))).toBeNull();
    expect(validateUpload(file("image/jpeg", 0))).toBeNull();
    expect(validateUpload(file("image/webp", MAX_FILE_BYTES))).toBeNull();
  });

  it("returns a message instead of throwing for an unsupported type", () => {
    // This is the regression: the old implementation threw, which escaped processFile's
    // caller (an onDrop/onChange handler with no .catch) as an unhandled rejection and
    // left the user with no feedback whatsoever.
    expect(() => validateUpload(file("application/pdf", 1024))).not.toThrow();
    expect(validateUpload(file("application/pdf", 1024))).toBe(UNSUPPORTED_FORMAT_MESSAGE);
    expect(validateUpload(file("text/plain", 10))).toBe(UNSUPPORTED_FORMAT_MESSAGE);
    expect(validateUpload(file("", 10))).toBe(UNSUPPORTED_FORMAT_MESSAGE);
  });

  it("returns a message instead of throwing for an oversized file", () => {
    expect(() => validateUpload(file("image/png", MAX_FILE_BYTES + 1))).not.toThrow();
    expect(validateUpload(file("image/png", MAX_FILE_BYTES + 1))).toBe(FILE_TOO_LARGE_MESSAGE);
  });

  it("rejects on type before size, so a PDF reports the format problem", () => {
    expect(validateUpload(file("application/pdf", MAX_FILE_BYTES + 1))).toBe(
      UNSUPPORTED_FORMAT_MESSAGE
    );
  });

  it("accepts every MIME type in the allow-list and nothing else", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(validateUpload(file(type, 10))).toBeNull();
    }
    // image/* is what the dropzone used to accept via startsWith, including formats
    // tesseract/validateUpload never supported (gif, svg, bmp, tiff).
    for (const type of ["image/gif", "image/svg+xml", "image/bmp", "image/tiff"]) {
      expect(validateUpload(file(type, 10))).toBe(UNSUPPORTED_FORMAT_MESSAGE);
    }
  });
});
