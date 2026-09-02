import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import type { NextFunction, Request, Response } from "express";
import type { OperationLogRepository } from "../../db/repositories/contracts/index.js";
import { HttpError } from "../../shared/errors/httpError.js";
import { resolveSampleRoomStorageRoot } from "./storageConfig.js";
import { multipartUploadMetrics } from "./attachmentRouteUtils.js";

const uploadWindowMs = 10 * 60 * 1000;
const uploadLimit = 600;
const concurrentUploadLimit = 20;
const retryAfterSeconds = 1;
const minimumFreeBytes = 20 * 1024 * 1024 * 1024;
const maximumTrackedAccounts = 10_000;

function uploadedFiles(req: Request) {
  return Array.isArray(req.files) ? req.files : [];
}

function isMultipart(req: Request) {
  return req.is("multipart/form-data") === "multipart/form-data";
}

export class AttachmentUploadSecurity {
  private activeUploads = 0;
  private readonly accountAttempts = new Map<string, number[]>();

  constructor(
    private readonly operationLogs: OperationLogRepository | undefined,
    private readonly env: NodeJS.ProcessEnv,
    private readonly freeBytes: (() => Promise<number>) | undefined = undefined
  ) {}

  private setAccountAttempts(accountId: string, attempts: number[]) {
    if (!this.accountAttempts.has(accountId) && this.accountAttempts.size >= maximumTrackedAccounts) {
      const oldest = this.accountAttempts.keys().next().value as string | undefined;
      if (oldest) this.accountAttempts.delete(oldest);
    }
    this.accountAttempts.set(accountId, attempts);
  }

  private async availableBytes() {
    const root = resolveSampleRoomStorageRoot(this.env);
    await fs.mkdir(root, { recursive: true });
    const stats = await fs.statfs(root);
    return Number(stats.bavail) * Number(stats.bsize);
  }

  private async audit(
    req: Request,
    uploadId: string,
    result: string,
    statusCode: number,
    fileCount = 0,
    totalSize = 0
  ) {
    const user = req.currentUser;
    await this.operationLogs?.appendOperationLog({
      ...(user ? { actorId: user.accountId ?? user.id, actorRole: user.role } : {}),
      action: "attachment.upload.request",
      targetType: "upload_request",
      targetId: uploadId,
      ip: req.ip || req.socket.remoteAddress,
      ...(req.header("user-agent") ? { userAgent: req.header("user-agent")! } : {}),
      payload: {
        method: req.method,
        route: req.originalUrl.split("?")[0],
        fileCount,
        totalSize,
        result,
        statusCode
      }
    });
  }

  private safeAudit(
    req: Request,
    uploadId: string,
    result: string,
    statusCode: number,
    fileCount = 0,
    totalSize = 0
  ) {
    void this.audit(req, uploadId, result, statusCode, fileCount, totalSize)
      .catch((error) => {
        console.error("attachment upload audit failed", {
          uploadId,
          error: error instanceof Error ? error.message : "unknown_error"
        });
      });
  }

  middleware = async (req: Request, res: Response, next: NextFunction) => {
    if (!isMultipart(req)) {
      next();
      return;
    }

    const uploadId = randomUUID();
    const user = req.currentUser;
    if (!user) {
      this.safeAudit(req, uploadId, "unauthenticated", 401);
      next(new HttpError(401, "unauthenticated"));
      return;
    }

    const now = Date.now();
    const accountId = user.accountId ?? user.id;
    const attempts = (this.accountAttempts.get(accountId) ?? [])
      .filter((value) => value > now - uploadWindowMs);
    if (attempts.length >= uploadLimit) {
      this.setAccountAttempts(accountId, attempts);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      this.safeAudit(req, uploadId, "account_rate_limited", 429);
      next(new HttpError(429, "upload_rate_limit_exceeded"));
      return;
    }
    if (this.activeUploads >= concurrentUploadLimit) {
      res.setHeader("Retry-After", String(retryAfterSeconds));
      this.safeAudit(req, uploadId, "server_concurrency_limited", 429);
      next(new HttpError(429, "upload_concurrency_limit_exceeded"));
      return;
    }

    // Reserve synchronously before any asynchronous disk check so concurrent
    // requests cannot all observe the same free slot.
    attempts.push(now);
    this.setAccountAttempts(accountId, attempts);
    this.activeUploads += 1;
    let released = false;
    const release = (result: string, statusCode = res.statusCode) => {
      if (released) return;
      released = true;
      this.activeUploads = Math.max(0, this.activeUploads - 1);
      const files = uploadedFiles(req);
      const metrics = multipartUploadMetrics(req);
      const totalSize = Math.max(
        metrics.totalSize,
        files.reduce((sum, file) => sum + file.size, 0)
      );
      this.safeAudit(
        req,
        uploadId,
        result,
        statusCode,
        Math.max(metrics.fileCount, files.length),
        totalSize
      );
    };
    res.once("finish", () => release(res.statusCode < 400 ? "accepted" : "rejected"));
    res.once("close", () => release("connection_closed"));
    req.once("aborted", () => release("request_aborted"));
    req.once("error", () => release("request_error"));
    req.once("close", () => {
      if (req.aborted || (!req.complete && req.destroyed)) {
        release("request_closed");
      }
    });

    const enforceDiskMinimum = this.env.NODE_ENV !== "test";
    if (enforceDiskMinimum) {
      try {
        const available = this.freeBytes
          ? await this.freeBytes()
          : await this.availableBytes();
        if (available < minimumFreeBytes) {
          release("insufficient_storage", 507);
          next(new HttpError(507, "insufficient_storage"));
          return;
        }
      } catch {
        release("storage_check_failed", 507);
        next(new HttpError(507, "storage_unavailable"));
        return;
      }
    }

    if (released || req.aborted || (!req.complete && req.destroyed)) {
      release("request_aborted");
      return;
    }
    next();
  };
}
