import { describe, expect, it } from "vitest";
import type { Response } from "express";
import {
  normalizeUploadedFileName,
  safeAttachmentPreviewMime,
  sendAttachmentDownload
} from "./attachmentRouteUtils.js";

describe("attachment route filename utilities", () => {
  it("normalizes UTF-8 filenames decoded as latin1 without double-decoding valid names", () => {
    const chineseName = "客户打样单_中文文件名.xlsx";
    const mojibakeName = Buffer.from(chineseName, "utf8").toString("latin1");
    const doubleMojibakeName = Buffer.from(mojibakeName, "utf8").toString("latin1");

    expect(normalizeUploadedFileName(mojibakeName)).toBe(chineseName);
    expect(normalizeUploadedFileName(doubleMojibakeName)).toBe(chineseName);
    expect(normalizeUploadedFileName(chineseName)).toBe(chineseName);
  });

  it("keeps display filenames detached from path-like upload input", () => {
    expect(normalizeUploadedFileName("../unsafe/客户图纸 [v1].pdf")).toBe("客户图纸 [v1].pdf");
    expect(normalizeUploadedFileName("..\\unsafe\\sample photo.png")).toBe("sample photo.png");
  });

  it("recognizes only magic-header verified preview formats", () => {
    expect(safeAttachmentPreviewMime(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBe("image/jpeg");
    expect(safeAttachmentPreviewMime(Buffer.from("%PDF-1.7\n"))).toBe("application/pdf");
    expect(safeAttachmentPreviewMime(Buffer.from("<script>alert(1)</script>"))).toBeUndefined();
    expect(safeAttachmentPreviewMime(Buffer.from("<svg><script/></svg>"))).toBeUndefined();
    expect(safeAttachmentPreviewMime(Buffer.from("not really a png"))).toBeUndefined();
    for (const businessFile of ["DXF", "%!PS-Adobe", "CDR", "PK\u0003\u0004"]) {
      expect(safeAttachmentPreviewMime(Buffer.from(businessFile))).toBeUndefined();
    }
  });

  it("removes trailing spaces and dots before later extension checks", () => {
    expect(normalizeUploadedFileName("payload.exe.  ")).toBe("payload.exe");
  });

  it("forces stored active content to a download-only octet stream", () => {
    const headers = new Map<string, string>();
    let sent: Buffer | undefined;
    const response = {
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), value);
      },
      send(content: Buffer) {
        sent = content;
      }
    } as unknown as Response;
    const content = Buffer.from("<html><script>alert(1)</script></html>");
    sendAttachmentDownload(response, {
      fileName: "report.html",
      mimeType: "text/html",
      size: content.length,
      content
    });
    expect(headers.get("content-type")).toBe("application/octet-stream");
    expect(headers.get("content-disposition")).toContain("attachment;");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(sent).toBe(content);
  });
});
