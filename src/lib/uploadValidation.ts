export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const UNSUPPORTED_FORMAT_MESSAGE =
  "Unsupported file format. Please upload JPEG, PNG, or WebP.";
export const FILE_TOO_LARGE_MESSAGE = "File size exceeds 10 MB limit.";

/**
 * Returns a human-readable rejection message, or `null` if the file is acceptable.
 *
 * It deliberately does NOT throw. Every call site invokes this from an async handler
 * that is not itself wrapped in a `.catch()` (a drop/change event listener), so a throw
 * escapes as an unhandled promise rejection: the UI never learns why the file was
 * refused and the user gets no feedback at all. Returning the message lets the caller
 * surface it and lets the drop path and the picker path share one verdict.
 */
export function validateUpload(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return UNSUPPORTED_FORMAT_MESSAGE;
  }
  if (file.size > MAX_FILE_BYTES) {
    return FILE_TOO_LARGE_MESSAGE;
  }
  return null;
}
