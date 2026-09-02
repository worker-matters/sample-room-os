export const ORDER_STAGES = {
  pendingReceive: "pending_receive",
  patternWaiting: "pattern_waiting",
  patternDoing: "pattern_doing",
  cuttingHandoffWaiting: "cutting_handoff_waiting",
  cuttingWaiting: "cutting_waiting",
  cuttingDoing: "cutting_doing",
  sewingWaiting: "sewing_waiting",
  sewingDoing: "sewing_doing",
  qcDeliveryWaiting: "qc_delivery_waiting",
  done: "done"
} as const;

export type OrderStage = (typeof ORDER_STAGES)[keyof typeof ORDER_STAGES];

export const ORDER_STAGE_LABELS: Record<OrderStage, string> = {
  pending_receive: "待接单",
  pattern_waiting: "待完成版师任务",
  pattern_doing: "制版中",
  cutting_handoff_waiting: "待裁剪",
  cutting_waiting: "待裁剪",
  cutting_doing: "裁剪中",
  sewing_waiting: "待缝制",
  sewing_doing: "缝制中",
  qc_delivery_waiting: "待组检/出库",
  done: "已完成"
};

export const INTAKE_STATUSES = {
  pendingReceive: "pending_receive",
  received: "received",
  needsClientSupplement: "needs_client_supplement"
} as const;

export type IntakeStatus = (typeof INTAKE_STATUSES)[keyof typeof INTAKE_STATUSES];

export const INTAKE_STATUS_LABELS: Record<IntakeStatus, string> = {
  pending_receive: "待接单",
  received: "已接单",
  needs_client_supplement: "待客户补充"
};

export const PATTERN_STATUSES = {
  none: "none",
  has: "has"
} as const;

export type PatternStatus = (typeof PATTERN_STATUSES)[keyof typeof PATTERN_STATUSES];

export const PATTERN_STATUS_LABELS: Record<PatternStatus, string> = {
  none: "需制版",
  has: "客户来版"
};

export const MATERIAL_STATUSES = {
  missing: "missing",
  partial: "partial",
  complete: "complete"
} as const;

export const PATTERN_SOURCE_TYPES = {
  none: "none",
  customerProvided: "customer_provided",
  previousOrder: "previous_order",
  sameOrderRevision: "same_order_revision"
} as const;

export type PatternSourceType =
  (typeof PATTERN_SOURCE_TYPES)[keyof typeof PATTERN_SOURCE_TYPES];

export const SAMPLE_REQUEST_ITEMS = {
  sampleGarment: "sample_garment",
  sampleSmall: "sample_small",
  cutting: "cutting",
  patternMaking: "pattern_making",
  materialCheck: "material_check",
  quoteMaterialCheck: "quote_material_check",
  bulkMaterialCheck: "bulk_material_check",
  processInstruction: "process_instruction",
  patternPaddingAmount: "pattern_padding_amount",
  patternZipperLength: "pattern_zipper_length",
  patternFullSize: "pattern_full_size",
  patternFullSizeInkjet: "pattern_full_size_inkjet",
  patternFullSizeCutting: "pattern_full_size_cutting",
  patternRevision: "pattern_revision",
  patternPrintPosition: "pattern_print_position",
  patternEmbroideryPosition: "pattern_embroidery_position",
  patternSampleCut: "pattern_sample_cut",
  materialLayoutDiagram: "material_layout_diagram",
  materialMarker: "material_marker",
  render3d: "render_3d",
  rotationVideo3d: "rotation_video_3d"
} as const;

export type SampleRequestItem =
  (typeof SAMPLE_REQUEST_ITEMS)[keyof typeof SAMPLE_REQUEST_ITEMS];

export const PATTERN_TASK_REQUIREMENTS = [
  SAMPLE_REQUEST_ITEMS.patternMaking,
  SAMPLE_REQUEST_ITEMS.patternRevision,
  SAMPLE_REQUEST_ITEMS.patternFullSize,
  SAMPLE_REQUEST_ITEMS.quoteMaterialCheck,
  SAMPLE_REQUEST_ITEMS.bulkMaterialCheck,
  SAMPLE_REQUEST_ITEMS.patternPaddingAmount,
  SAMPLE_REQUEST_ITEMS.patternZipperLength
] as const satisfies readonly SampleRequestItem[];

export type PatternTaskRequirement = (typeof PATTERN_TASK_REQUIREMENTS)[number];

export const DEFAULT_SAMPLE_REQUEST_ITEMS: SampleRequestItem[] = [
  SAMPLE_REQUEST_ITEMS.sampleGarment,
  SAMPLE_REQUEST_ITEMS.cutting,
  SAMPLE_REQUEST_ITEMS.patternMaking
];

export function sampleGarmentRequiredFromItems(items: readonly SampleRequestItem[]) {
  return (
    items.includes(SAMPLE_REQUEST_ITEMS.sampleGarment) ||
    items.includes(SAMPLE_REQUEST_ITEMS.sampleSmall)
  );
}

export type MaterialStatus = (typeof MATERIAL_STATUSES)[keyof typeof MATERIAL_STATUSES];

export const MATERIAL_STATUS_LABELS: Record<MaterialStatus, string> = {
  missing: "未齐",
  partial: "部分到",
  complete: "全齐"
};
