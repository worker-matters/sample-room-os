import type { OrderCompletionStatus, OrderStage, SampleRequestItem } from "@sample-room/shared";
import type {
  OrderAttachmentRecord,
  OrderPatternTaskSummary,
  OrderRecord
} from "../orders/orderTypes.js";
import type { ProductionStage, ScanRecordDto } from "../scan/scanTypes.js";

export type PlannerOrderDto = {
  id: string;
  orderNo: string;
  sourceType: OrderRecord["sourceType"];
  createdByName?: string;
  customerName: string;
  salespersonName: string;
  styleNo: string;
  styleName: string;
  quantity: number;
  sampleType: string;
  sampleRound: string;
  deliveryDate: string;
  remark?: string | undefined;
  terminated: boolean;
  terminatedAt?: string | undefined;
  stage: OrderStage | null;
  stageLabel: string;
  patternStatus: string;
  fabricStatus: string;
  trimStatus: string;
  createdAt: string;
  updatedAt: string;
  sampleRequestItems: SampleRequestItem[];
  completionStatus: OrderCompletionStatus;
  attachmentCount: number;
  chargeCount: number;
  materialRecordCount: number;
  thumbnailUrl?: string | undefined;
  attachments: OrderAttachmentRecord[];
  attachmentLogs: import("../orders/orderTypes.js").AttachmentAuditLogRecord[];
  patternTask?: OrderPatternTaskSummary | undefined;
  scanRecords: ScanRecordDto[];
  activeWorker?: {
    stage: ProductionStage;
    stageLabel: string;
    workerName: string;
    startedAt: string;
  } | undefined;
};
