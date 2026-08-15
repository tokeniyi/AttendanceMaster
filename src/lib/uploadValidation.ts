export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateUpload(file: File): void {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Unsupported file format. Please upload JPEG, PNG, or WebP.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("File size exceeds 10 MB limit.");
  }
}
