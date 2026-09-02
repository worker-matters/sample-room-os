import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { HttpError } from "../../shared/errors/httpError.js";
import type { AttachmentDownload } from "../orders/orderService.js";
import { resolveSampleRoomStorageRoot } from "./storageConfig.js";

export const maxAttachmentBytes = 30 * 1024 * 1024;
export const maxAttachmentMegabytes = Math.floor(maxAttachmentBytes / 1024 / 1024);
export const maxAttachmentRequestBytes = 300 * 1024 * 1024;
export const maxAttachmentFiles = 30;
export const maxExcelImportBytes = 5 * 1024 * 1024;
const maxMultipartTextBytes = 128 * 1024;

export function assertAttachmentRequestBytes(totalBytes: number) {
  if (totalBytes > maxAttachmentRequestBytes) throw new HttpError(413, "upload_request_too_large");
}

const executableFileExtensions = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".msi",
  ".dll",
  ".scr",
  ".com"
]);

function normalizedLeafFileName(fileName: string) {
  const leaf = fileName.replace(/\\/g, "/").split("/").pop() ?? fileName;
  return leaf.trim().replace(/[ .]+$/g, "");
}

function extensionOf(fileName: string) {
  const leaf = normalizedLeafFileName(fileName);
  const dotIndex = leaf.lastIndexOf(".");
  return dotIndex >= 0 ? leaf.slice(dotIndex).toLowerCase() : "";
}

const requestBytes = Symbol("multipartRequestBytes");
const requestFileCount = Symbol("multipartRequestFileCount");

type RequestWithMultipartBytes = Request & {
  [requestBytes]?: number;
  [requestFileCount]?: number;
};

export function multipartUploadMetrics(req: Request) {
  const request = req as RequestWithMultipartBytes;
  return {
    fileCount: request[requestFileCount] ?? 0,
    totalSize: request[requestBytes] ?? 0
  };
}

type TemporaryUploadFile = Express.Multer.File & {
  checksum?: string;
  header?: Buffer;
};

async function unlinkTemporaryFile(temporaryPath: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.unlink(temporaryPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      if (code !== "EPERM" || attempt === 4) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
  }
}

function temporaryStreamingStorage(maxTotalBytes: number): multer.StorageEngine {
  return {
    _handleFile(req, file, callback) {
      const request = req as RequestWithMultipartBytes;
      request[requestFileCount] = (request[requestFileCount] ?? 0) + 1;
      const configuredRoot = req.app?.get("sampleRoomStorageRoot") as string | undefined;
      const uploadRoot = path.resolve(configuredRoot ?? resolveSampleRoomStorageRoot(), ".tmp", "uploads");
      const temporaryPath = path.join(uploadRoot, randomUUID());
      let fileSize = 0;
      let completed = false;
      const hash = createHash("sha256");
      const headerChunks: Buffer[] = [];
      let headerSize = 0;
      void fs.mkdir(uploadRoot, { recursive: true }).then(() => {
        const output = createWriteStream(temporaryPath, { flags: "wx" });
        const fail = (error: Error) => {
          if (completed) return;
          completed = true;
          file.stream.unpipe(output);
          output.destroy();
          void unlinkTemporaryFile(temporaryPath).catch((cleanupError: NodeJS.ErrnoException) => {
            if (cleanupError.code !== "ENOENT") console.error("temporary upload cleanup failed", { temporaryPath, error: cleanupError.message });
          });
          callback(error);
        };
        file.stream.on("data", (chunk: Buffer) => {
          if (completed) return;
          fileSize += chunk.length;
          request[requestBytes] = (request[requestBytes] ?? 0) + chunk.length;
          hash.update(chunk);
          if (headerSize < 512) {
            const part = chunk.subarray(0, 512 - headerSize);
            headerChunks.push(part);
            headerSize += part.length;
          }
          if ((request[requestBytes] ?? 0) > maxTotalBytes) {
            try {
              assertAttachmentRequestBytes(request[requestBytes] ?? 0);
            } catch (error) {
              fail(error as Error);
            }
          }
        });
        file.stream.once("error", fail);
        output.once("error", fail);
        output.once("finish", () => {
          if (completed) return;
          completed = true;
          callback(null, {
            path: temporaryPath,
            size: fileSize,
            checksum: hash.digest("hex"),
            header: Buffer.concat(headerChunks, headerSize)
          } as TemporaryUploadFile);
        });
        file.stream.pipe(output);
      }).catch((error: Error) => callback(error));
    },
    _removeFile(_req, file, callback) {
      const temporaryPath = (file as TemporaryUploadFile).path;
      if (!temporaryPath) return callback(null);
      unlinkTemporaryFile(temporaryPath).then(() => callback(null)).catch((error: NodeJS.ErrnoException) => callback(error.code === "ENOENT" ? null : error));
    }
  };
}

function extensionAllowedForExcel(fileName: string) {
  return extensionOf(fileName) === ".xlsx";
}

function hasZipHeader(buffer: Buffer) {
  return buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;
}

function hasPdfHeader(buffer: Buffer) {
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

function detectedImageMime(buffer: Buffer): string | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString("ascii") === "BM") {
    return "image/bmp";
  }
  return undefined;
}

export function safeAttachmentPreviewMime(buffer: Buffer) {
  return detectedImageMime(buffer) ?? (hasPdfHeader(buffer) ? "application/pdf" : undefined);
}

function validatePreviewFileHeaders(req: Request, _res: Response, next: NextFunction) {
  try {
    for (const file of uploadedFiles(req)) {
      // Only formats whose bytes are positively identified enter a browser
      // preview path. Every other business attachment remains downloadable.
      const header = (file as TemporaryUploadFile).header ?? file.buffer ?? Buffer.alloc(0);
      file.mimetype = safeAttachmentPreviewMime(header) ?? "application/octet-stream";
    }
    next();
  } catch (error) {
    next(error);
  }
}

function multipartTextBytes(value: unknown): number {
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + multipartTextBytes(item), 0);
  }
  return 0;
}

function validateMultipartTextTotal(req: Request, _res: Response, next: NextFunction) {
  const totalBytes = Object.values(req.body as Record<string, unknown>)
    .reduce<number>((sum, value) => sum + multipartTextBytes(value), 0);
  if (totalBytes > maxMultipartTextBytes) {
    next(new HttpError(413, "multipart_fields_too_large"));
    return;
  }
  next();
}

const attachmentParser = multer({
  storage: temporaryStreamingStorage(maxAttachmentRequestBytes),
  limits: {
    files: maxAttachmentFiles,
    // Busboy marks a stream truncated as soon as it reaches its parser limit.
    // Keep the parser one byte above the inclusive business limit so exactly
    // 30 MiB succeeds while 30 MiB + 1 is rejected by the real multipart path.
    fileSize: maxAttachmentBytes + 1,
    fields: 40,
    fieldSize: 64 * 1024,
    parts: 70
  },
  fileFilter: (_req, file, callback) => {
    if (executableFileExtensions.has(extensionOf(file.originalname))) {
      callback(
        new HttpError(
          400,
          "不支持上传可执行程序，请上传版子文件、图片、PDF、压缩包或说明文件。"
        )
      );
      return;
    }

    callback(null, true);
  }
}).array("files", maxAttachmentFiles);

async function cleanupTemporaryUploads(req: Request) {
  for (const file of uploadedFiles(req)) {
    const temporaryPath = (file as TemporaryUploadFile).path;
    if (!temporaryPath) continue;
    try {
      await unlinkTemporaryFile(temporaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("temporary upload cleanup failed", { temporaryPath, error: error instanceof Error ? error.message : "unknown_error" });
      }
    }
  }
}

export const attachmentUploadMiddleware: import("express").RequestHandler =
  (req, res, next) => {
    attachmentParser(req, res, (error) => {
      if (error) {
        void cleanupTemporaryUploads(req).finally(() => next(error));
        return;
      }
      const cleanup = () => void cleanupTemporaryUploads(req);
      res.once("finish", cleanup);
      res.once("close", cleanup);
      req.once("aborted", cleanup);
      validateMultipartTextTotal(req, res, (textError) => {
        if (textError) {
          next(textError);
          return;
        }
        validatePreviewFileHeaders(req, res, next);
      });
    });
  };

const excelParser = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: maxExcelImportBytes,
    fields: 10,
    fieldSize: 64 * 1024,
    parts: 11
  },
  fileFilter: (_req, file, callback) => {
    if (!extensionAllowedForExcel(file.originalname)) {
      callback(new HttpError(400, "only_xlsx_import_is_supported"));
      return;
    }
    callback(null, true);
  }
}).array("files", 1);

function validateExcelHeader(req: Request, _res: Response, next: NextFunction) {
  const files = uploadedFiles(req);
  if (files.length !== 1) {
    next(new HttpError(400, "exactly_one_excel_file_is_required"));
    return;
  }
  if (!hasZipHeader(files[0]!.buffer)) {
    next(new HttpError(400, "uploaded_file_is_not_an_xlsx_workbook"));
    return;
  }
  next();
}

export const excelImportUploadMiddleware: import("express").RequestHandler =
  (req, res, next) => {
    excelParser(req, res, (error) => {
      if (error) {
        next(error);
        return;
      }
      validateMultipartTextTotal(req, res, (textError) => {
        if (textError) {
          next(textError);
          return;
        }
        validateExcelHeader(req, res, next);
      });
    });
  };

function asTextArray(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  return typeof value === "string" ? [value] : [];
}

function uploadedFiles(req: Request): Express.Multer.File[] {
  return Array.isArray(req.files) ? req.files : [];
}

const replacementChar = "\uFFFD";
const mojibakeHintPattern = /[ÃÂâåæçèé]/u;
const mojibakeHintGlobalPattern = /[ÃÂâåæçèé]/gu;
const cjkPattern = /[\u3400-\u9fff]/u;

function leafFileName(value: string) {
  const leaf = normalizedLeafFileName(value);
  return leaf && leaf.length > 0 ? leaf : "attachment";
}

function shouldUseLatin1Utf8Decode(rawName: string, decodedName: string) {
  if (decodedName === rawName || decodedName.includes(replacementChar)) {
    return false;
  }

  if (cjkPattern.test(decodedName) && !cjkPattern.test(rawName)) {
    return true;
  }

  const rawMojibakeScore = (rawName.match(mojibakeHintGlobalPattern) ?? []).length;
  const decodedMojibakeScore = (decodedName.match(mojibakeHintGlobalPattern) ?? []).length;
  return rawMojibakeScore > 0 && decodedMojibakeScore < rawMojibakeScore;
}

export function normalizeUploadedFileName(rawName: string): string {
  let fileName = leafFileName(rawName);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const decodedName = Buffer.from(fileName, "latin1").toString("utf8");
    if (!shouldUseLatin1Utf8Decode(fileName, decodedName)) {
      break;
    }
    fileName = decodedName;
  }

  return fileName;
}

export function uploadedAttachmentsFromRequest(req: Request) {
  const categories = asTextArray(req.body.category ?? req.body.categories);
  const visibilities = asTextArray(req.body.visibility ?? req.body.visibilities);
  let metadataValue: unknown = req.body.attachmentMetadata;
  if (typeof metadataValue === "string") {
    try {
      metadataValue = JSON.parse(metadataValue) as unknown;
    } catch {
      metadataValue = [];
    }
  }
  const bundledMetadata = Array.isArray(metadataValue) ? metadataValue : [];
  return uploadedFiles(req).map((file, index) => ({
    fileName: normalizeUploadedFileName(file.originalname),
    mimeType: file.mimetype || "application/octet-stream",
    size: file.size,
    temporaryPath: (file as TemporaryUploadFile).path,
    checksum: (file as TemporaryUploadFile).checksum,
    category:
      (typeof bundledMetadata[index] === "object" &&
      bundledMetadata[index] !== null &&
      typeof bundledMetadata[index].category === "string"
        ? bundledMetadata[index].category
        : undefined) ??
      categories[index] ??
      categories[0],
    visibility:
      (typeof bundledMetadata[index] === "object" &&
      bundledMetadata[index] !== null &&
      typeof bundledMetadata[index].visibility === "string"
        ? bundledMetadata[index].visibility
        : undefined) ??
      visibilities[index] ??
      visibilities[0],
    ...(file.buffer ? { buffer: file.buffer } : {})
  }));
}

const multipartJsonFields = new Set([
  "sampleRequestItems",
  "completedRequirements",
  "structuredData",
  "multipartPayload",
  "attachmentMetadata",
  "files",
  "customerSnapshot",
  "clientUserSnapshot"
]);

function parsedMultipartBody(body: Record<string, unknown>) {
  const parsed: Record<string, unknown> = { ...body };
  const parseKnownJsonFields = () => {
    for (const key of multipartJsonFields) {
      const value = parsed[key];
      if (typeof value !== "string") continue;
      try {
        parsed[key] = JSON.parse(value) as unknown;
      } catch {
        // Domain validation produces the authoritative 400 response for malformed values.
      }
    }
  };
  parseKnownJsonFields();
  if (
    parsed.multipartPayload &&
    typeof parsed.multipartPayload === "object" &&
    !Array.isArray(parsed.multipartPayload)
  ) {
    Object.assign(parsed, parsed.multipartPayload);
    parseKnownJsonFields();
  }
  delete parsed.multipartPayload;
  delete parsed.attachmentMetadata;
  return parsed;
}

export function bodyWithUploadedAttachments(req: Request) {
  const attachments = uploadedAttachmentsFromRequest(req);
  const parsedBody = parsedMultipartBody(req.body as Record<string, unknown>);
  if (attachments.length === 0) {
    return parsedBody;
  }

  const body: Record<string, unknown> = { ...parsedBody, attachments };
  if (typeof body.quantity === "string" && body.quantity.trim().length > 0) {
    body.quantity = Number(body.quantity);
  }

  return body;
}

export function attachmentPayloadFromRequest(req: Request) {
  const attachments = uploadedAttachmentsFromRequest(req);
  const parsedBody = parsedMultipartBody(req.body as Record<string, unknown>);
  if (attachments.length > 0) {
    return { ...parsedBody, attachments };
  }

  return parsedBody;
}

function contentDisposition(fileName: string) {
  const fallback = fileName.replace(/[^\x20-\x7e]+/g, "_").replace(/["\\]/g, "_") || "attachment";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function sendAttachmentDownload(res: Response, download: AttachmentDownload) {
  res.setHeader(
    "Content-Type",
    safeAttachmentPreviewMime(download.content) ?? "application/octet-stream"
  );
  res.setHeader("Content-Length", String(download.content.length));
  res.setHeader("Content-Disposition", contentDisposition(download.fileName));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(download.content);
}
