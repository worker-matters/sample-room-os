import { Router, type Request, type RequestHandler } from "express";
import { HttpError } from "../../shared/errors/httpError.js";
import {
  attachmentPayloadFromRequest,
  attachmentUploadMiddleware,
  safeAttachmentPreviewMime
} from "../files/attachmentRouteUtils.js";
import { renamedDisplayFileName } from "../files/attachmentDisplayName.js";
import type { CollaborativeScanWorkflowService } from "./collaborativeScanService.js";
import type { ScanResolveService } from "./scanResolveService.js";
import type { ScanTestIdentityProvider } from "./scanTestIdentity.js";
import {
  maxQcEvidencePhotos,
  QcEvidenceUploadBatchStore,
  type QcEvidenceBatchAction
} from "./qcEvidenceUploadBatchStore.js";

function routeToken(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    throw new Error("route token is required");
  }

  return value;
}

function completionPayload(req: Request) {
  const payload = attachmentPayloadFromRequest(req);
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  if (req.body?.displayName === undefined || attachments.length === 0) {
    return payload;
  }
  if (attachments.length !== 1) {
    throw new HttpError(400, "displayName supports exactly one uploaded file.");
  }
  const attachment = attachments[0];
  if (!attachment || typeof attachment !== "object" || !("fileName" in attachment) || typeof attachment.fileName !== "string") {
    return payload;
  }
  return {
    ...payload,
    attachments: [{
      ...attachment,
      fileName: renamedDisplayFileName(attachment.fileName, req.body.displayName)
    }]
  };
}

export function createScanRouter(
  scanWorkflowService: CollaborativeScanWorkflowService,
  scanResolveService: ScanResolveService,
  scanTestIdentityProvider: ScanTestIdentityProvider,
  uploadSecurity: RequestHandler,
  qcEvidenceUploadBatches = new QcEvidenceUploadBatchStore()
) {
  const router = Router();

  async function requestIdentity(req: Request) {
    return scanTestIdentityProvider.resolve(req.header("x-test-scan-identity"));
  }

  async function effectiveCurrentUser(req: Request) {
    const currentUser = (await requestIdentity(req))?.currentUser ?? req.currentUser;
    if (!currentUser) throw new HttpError(401, "unauthenticated");
    return currentUser;
  }

  function batchAction(value: unknown): QcEvidenceBatchAction {
    if (value !== "complete") {
      throw new HttpError(400, "QC evidence upload action is invalid.");
    }
    return value;
  }

  async function authorizeBatchAction(
    token: string,
    action: QcEvidenceBatchAction,
    req: Request
  ) {
    const currentUser = await effectiveCurrentUser(req);
    await scanWorkflowService.authorizeCompletionUpload(token, currentUser);
    return currentUser;
  }

  async function payloadWithQcEvidenceBatch(
    req: Request,
    action: QcEvidenceBatchAction
  ) {
    const payload = completionPayload(req);
    const batchId = payload.qcEvidenceBatchId;
    if (batchId === undefined) return { payload };
    if (typeof batchId !== "string") {
      throw new HttpError(400, "qcEvidenceBatchId must be a string.");
    }
    const token = routeToken(req.params.token);
    const currentUser = await effectiveCurrentUser(req);
    return {
      batchId,
      payload: {
        ...payload,
        attachments: await qcEvidenceUploadBatches.attachmentsForCompletion(batchId, {
          scanToken: token,
          userId: currentUser.id,
          action
        })
      }
    };
  }

  router.post("/resolve", async (req, res) => {
    const testIdentity = await requestIdentity(req);
    res.json(await scanResolveService.resolve(req.body?.payload, {
      currentUser: testIdentity?.currentUser ?? req.currentUser,
      testIdentity: Boolean(testIdentity)
    }));
  });

  router.get("/:token/thumbnail", async (req, res) => {
    const thumbnail = await scanWorkflowService.getPublicThumbnail(routeToken(req.params.token));
    const safeMime = safeAttachmentPreviewMime(thumbnail.content);
    if (!safeMime?.startsWith("image/")) throw new HttpError(404, "thumbnail not found.");
    res.setHeader("Content-Type", safeMime);
    res.setHeader("Content-Length", thumbnail.content.length.toString());
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(thumbnail.content);
  });

  router.get("/:token", async (req, res) => {
    res.json({
      state: await scanWorkflowService.getScanState(
        routeToken(req.params.token),
        await effectiveCurrentUser(req)
      )
    });
  });

  router.post("/:token/start", async (req, res) => {
    res.json({
      state: await scanWorkflowService.startScan(
        routeToken(req.params.token),
        await effectiveCurrentUser(req)
      )
    });
  });

  router.post("/:token/qc-evidence-batches", async (req, res) => {
    const token = routeToken(req.params.token);
    const action = batchAction(req.body?.action);
    const currentUser = await authorizeBatchAction(token, action, req);
    const batch = await qcEvidenceUploadBatches.create({
      scanToken: token,
      userId: currentUser.id,
      action
    });
    res.status(201).json({
      batchId: batch.id,
      expiresAt: batch.expiresAt,
      maxFiles: maxQcEvidencePhotos
    });
  });

  router.post(
    "/:token/qc-evidence-batches/:batchId/files",
    async (req, _res, next) => {
      const token = routeToken(req.params.token);
      const currentUser = await effectiveCurrentUser(req);
      const action = await qcEvidenceUploadBatches.actionFor(
        routeToken(req.params.batchId),
        token,
        currentUser.id
      );
      await authorizeBatchAction(token, action, req);
      next();
    },
    uploadSecurity,
    attachmentUploadMiddleware,
    async (req, res) => {
      const token = routeToken(req.params.token);
      const batchId = routeToken(req.params.batchId);
      const currentUser = await effectiveCurrentUser(req);
      const action = await qcEvidenceUploadBatches.actionFor(batchId, token, currentUser.id);
      const payload = attachmentPayloadFromRequest(req);
      const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
      if (attachments.length !== 1) {
        throw new HttpError(400, "upload exactly one QC sample photo at a time.");
      }
      const photo = attachments[0];
      if (
        !photo ||
        typeof photo !== "object" ||
        !("fileName" in photo) ||
        !("mimeType" in photo) ||
        !("size" in photo) ||
        typeof photo.fileName !== "string" ||
        typeof photo.mimeType !== "string" ||
        typeof photo.size !== "number" ||
        (!Buffer.isBuffer(photo.buffer) && !("temporaryPath" in photo && typeof photo.temporaryPath === "string"))
      ) {
        throw new HttpError(400, "invalid QC sample photo.");
      }
      res.status(201).json(await qcEvidenceUploadBatches.appendPhoto(
        batchId,
        { scanToken: token, userId: currentUser.id, action },
        photo,
        req.body?.displayName,
        req.body?.category
      ));
    }
  );

  router.post(
    "/:token/complete",
    async (req, _res, next) => {
      await scanWorkflowService.authorizeCompletionUpload(
        routeToken(req.params.token),
        await effectiveCurrentUser(req)
      );
      next();
    },
    uploadSecurity,
    attachmentUploadMiddleware,
    async (req, res) => {
      const batch = await payloadWithQcEvidenceBatch(req, "complete");
      const state = await scanWorkflowService.completeScan(
        routeToken(req.params.token),
        await effectiveCurrentUser(req),
        batch.payload
      );
      if (batch.batchId) await qcEvidenceUploadBatches.discard(batch.batchId);
      res.json({
        state
      });
    }
  );

  router.post("/:token/sewing-takeover", async (req, res) => {
    res.json({
      state: await scanWorkflowService.takeoverSewing(
        routeToken(req.params.token),
        await effectiveCurrentUser(req),
        req.body
      )
    });
  });

  router.post("/:token/sewing-collaboration", async (req, res) => {
    res.json({
      state: await scanWorkflowService.joinCollaborativeSewing(
        routeToken(req.params.token),
        await effectiveCurrentUser(req),
        req.body ?? {}
      )
    });
  });

  router.delete("/:token/attachments/:attachmentId", async (req, res) => {
    res.json({
      attachments: await scanWorkflowService.deleteOwnQcAttachment(
        routeToken(req.params.token),
        await effectiveCurrentUser(req),
        routeToken(req.params.attachmentId)
      )
    });
  });

  router.get("/:token/attachments/:attachmentId/download", async (req, res) => {
    const download = await scanWorkflowService.downloadOwnQcAttachment(
      routeToken(req.params.token),
      await effectiveCurrentUser(req),
      routeToken(req.params.attachmentId)
    );
    const safeMime = safeAttachmentPreviewMime(download.content);
    if (!safeMime?.startsWith("image/")) throw new HttpError(404, "attachment not found.");
    res.setHeader("Content-Type", safeMime);
    res.setHeader("Content-Length", download.content.length.toString());
    res.setHeader("Cache-Control", "private, no-store");
    res.send(download.content);
  });

  return router;
}
