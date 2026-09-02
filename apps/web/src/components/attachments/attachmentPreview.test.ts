import { describe, expect, it } from "vitest";
import {
  isSafeAttachmentPreviewMime,
  isSafeImagePreviewMime
} from "./attachmentPreview";

describe("attachment preview policy", () => {
  it("allows only the magic-header normalized image and PDF MIME types", () => {
    for (const mimeType of ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"]) {
      expect(isSafeImagePreviewMime(mimeType)).toBe(true);
      expect(isSafeAttachmentPreviewMime(mimeType)).toBe(true);
    }
    expect(isSafeAttachmentPreviewMime("application/pdf")).toBe(true);
    expect(isSafeAttachmentPreviewMime("image/svg+xml")).toBe(false);
    expect(isSafeAttachmentPreviewMime("text/html")).toBe(false);
    expect(isSafeAttachmentPreviewMime("application/javascript")).toBe(false);
    expect(isSafeAttachmentPreviewMime("application/octet-stream")).toBe(false);
  });
});
