import type { OperationLogRepository } from "../../db/repositories/contracts/index.js";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import type { CurrentUser } from "../auth/currentUser.js";
import type { OrderAttachmentRecord } from "../orders/orderTypes.js";
import type { EffectiveAttachmentVisibility } from "./attachmentVisibility.js";

export async function auditAttachmentVisibilityChange(input: {
  repository: SampleRoomRepository;
  operationLogs?: OperationLogRepository | undefined;
  orderId: string;
  resourceId: string;
  source: "order_attachment" | "pattern_deliverable";
  originalFileName: string;
  originalVisibility: string;
  newVisibility: EffectiveAttachmentVisibility;
  currentUser: CurrentUser;
  originalUploaderId: string;
  originalUploaderName?: string | undefined;
  originalUploaderRole: OrderAttachmentRecord["uploadedByRole"];
  attachmentCategory: string;
  sourceCategory?: string | undefined;
  patternTaskId?: string | undefined;
  patternTaskCategory?: string | undefined;
}) {
  await Promise.all([
    input.repository.appendAttachmentAuditLog({
      orderId: input.orderId,
      attachmentId: input.resourceId,
      originalFileName: input.originalFileName,
      action: "visibility_change",
      actorId: input.currentUser.id,
      actorName: input.currentUser.displayName,
      actorRole: input.currentUser.role,
      originalUploaderId: input.originalUploaderId,
      originalUploaderName: input.originalUploaderName,
      originalUploaderRole: input.originalUploaderRole,
      attachmentCategory: input.attachmentCategory,
      sourceCategory: input.sourceCategory,
      patternTaskId: input.patternTaskId,
      patternTaskCategory: input.patternTaskCategory
    }),
    input.operationLogs?.appendOperationLog({
      actorId: input.currentUser.id,
      actorRole: input.currentUser.role,
      action: "attachment.visibility_change",
      targetType: input.source,
      targetId: input.resourceId,
      before: {
        orderId: input.orderId,
        visibility: input.originalVisibility
      },
      after: {
        orderId: input.orderId,
        visibility: input.newVisibility
      },
      payload: { source: input.source }
    })
  ]);
}
