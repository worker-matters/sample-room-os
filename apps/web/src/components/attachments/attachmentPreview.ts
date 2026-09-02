const safeImageMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp"
]);

export function isSafeImagePreviewMime(mimeType: string | undefined) {
  return Boolean(mimeType && safeImageMimeTypes.has(mimeType.toLowerCase()));
}

export function isSafeAttachmentPreviewMime(mimeType: string | undefined) {
  return isSafeImagePreviewMime(mimeType) || mimeType?.toLowerCase() === "application/pdf";
}
