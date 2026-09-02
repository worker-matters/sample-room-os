import type { OrderAttachmentRecord } from "../orders/orderTypes.js";
import type { QualityResult, ScanPageState } from "../scan/scanTypes.js";

export type QcOrderFilters = {
  q?: string | undefined;
  customerId?: string | undefined;
  clientUserId?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
};

export type QcOrderListItem = {
  orderId: string;
  orderNo: string;
  styleNo: string;
  styleName: string;
  sampleType: string;
  sampleRound: string;
  quantity: number;
  customerId: string;
  customerName: string;
  clientUserId: string;
  salespersonName: string;
  eventTime: string;
  qualityResult: Extract<QualityResult, "qualified" | "rework">;
  qualityScore?: number | undefined;
  note?: string | undefined;
  pieces?: number | undefined;
  thumbnailUrl?: string | undefined;
  remark?: string | undefined;
  taskInstructionNote?: string | undefined;
  workerName?: string | undefined;
};

export type QcOrderFilterOptions = {
  customers: Array<{ id: string; name: string }>;
  salespersons: Array<{ id: string; name: string }>;
};

export type QcOrderListResponse = {
  orders: QcOrderListItem[];
  filterOptions: QcOrderFilterOptions;
};

export type QcOrderDetail = QcOrderListItem & {
  state: ScanPageState;
  attachments: OrderAttachmentRecord[];
  latestRework?: {
    note?: string | undefined;
    eventTime: string;
    workerName?: string | undefined;
    photos: OrderAttachmentRecord[];
  } | undefined;
};
