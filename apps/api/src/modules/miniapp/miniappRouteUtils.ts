import { parseOrderQrPayload } from "@sample-room/shared";
import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "../auth/currentUser.js";
import { miniappSessionToken } from "./miniappSession.js";

export function createMiniappIdentityMiddleware(
  resolve: (token: string) => Promise<CurrentUser>
) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.currentUser = await resolve(miniappSessionToken(req));
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function miniappCurrentUser(req: Request) {
  if (!req.currentUser) throw new HttpError(401, "miniapp_session_invalid");
  return req.currentUser;
}

export function miniappRouteId(value: string | string[] | undefined) {
  if (typeof value !== "string") throw new Error("route id is required");
  return value;
}

export function miniappOrderScanToken(value: unknown) {
  if (typeof value !== "string") throw new HttpError(400, "invalid_order_qr_payload");
  try {
    return parseOrderQrPayload(value).token;
  } catch {
    throw new HttpError(400, "invalid_order_qr_payload");
  }
}

export function attachmentForMiniapp(
  attachment: Record<string, unknown>,
  currentUser: CurrentUser
) {
  const {
    storageKey: _storageKey,
    relativePath: _relativePath,
    physicalPath: _physicalPath,
    checksum: _checksum,
    ...safeAttachment
  } = attachment;
  const isOwnAttachment = attachment.uploadedBy === currentUser.id;
  return {
    ...safeAttachment,
    hasFile: attachment.hasFile === true || typeof attachment.storageKey === "string",
    canRename: isOwnAttachment,
    canDelete: isOwnAttachment
  };
}

export function chargeForMiniapp(
  charge: Record<string, unknown> & { creatorId?: unknown },
  currentUser: CurrentUser
) {
  const attachments = Array.isArray(charge.attachments)
    ? charge.attachments.map((attachment) => {
        if (typeof attachment !== "object" || attachment === null) return attachment;
        const record = attachment as Record<string, unknown>;
        return attachmentForMiniapp(record, currentUser);
      })
    : [];
  const canEditPending =
    charge.creatorId === currentUser.id &&
    (charge.status === "pending" || charge.status === "effective");
  return {
    id: charge.id,
    orderId: charge.orderId,
    name: charge.name,
    amount: charge.amount,
    explanation: charge.explanation,
    sourceScene: charge.sourceScene,
    creatorName: charge.creatorName,
    creatorRole: charge.creatorRole,
    status: charge.status,
    reviewedAt: charge.reviewedAt,
    createdAt: charge.createdAt,
    updatedAt: charge.updatedAt,
    attachments,
    canRename: canEditPending,
    canVoid: canEditPending
  };
}
