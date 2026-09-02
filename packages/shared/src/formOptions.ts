import {
  INTAKE_STATUSES,
  MATERIAL_STATUSES,
  ORDER_STAGES,
  PATTERN_STATUSES,
  PATTERN_SOURCE_TYPES,
  SAMPLE_REQUEST_ITEMS,
  type IntakeStatus,
  type MaterialStatus,
  type OrderStage,
  type PatternSourceType,
  type PatternStatus,
  type SampleRequestItem
} from "./statuses.js";

export type FormOption<T extends string> = {
  label: string;
  value: T;
};

export const fabricStatusOptions: Array<FormOption<MaterialStatus>> = [
  { label: "未齐", value: MATERIAL_STATUSES.missing },
  { label: "部分到", value: MATERIAL_STATUSES.partial },
  { label: "全齐", value: MATERIAL_STATUSES.complete }
];

export const trimStatusOptions: Array<FormOption<MaterialStatus>> = [
  { label: "未齐", value: MATERIAL_STATUSES.missing },
  { label: "部分到", value: MATERIAL_STATUSES.partial },
  { label: "全齐", value: MATERIAL_STATUSES.complete }
];

export const patternStatusOptions: Array<FormOption<PatternStatus>> = [
  { label: "客户来版", value: PATTERN_STATUSES.has },
  { label: "需制版", value: PATTERN_STATUSES.none }
];

export const patternSourceTypeOptions: Array<FormOption<PatternSourceType>> = [
  { label: "无基础版，需新制", value: PATTERN_SOURCE_TYPES.none },
  { label: "客户来版", value: PATTERN_SOURCE_TYPES.customerProvided },
  { label: "基于历史订单版", value: PATTERN_SOURCE_TYPES.previousOrder },
  { label: "本订单补改版", value: PATTERN_SOURCE_TYPES.sameOrderRevision }
];

export const sampleRequestItemOptions: Array<FormOption<SampleRequestItem>> = [
  { label: "生产样衣", value: SAMPLE_REQUEST_ITEMS.sampleGarment },
  { label: "生产小样", value: SAMPLE_REQUEST_ITEMS.sampleSmall },
  { label: "制版", value: SAMPLE_REQUEST_ITEMS.patternMaking },
  { label: "改版", value: SAMPLE_REQUEST_ITEMS.patternRevision },
  { label: "推全码版", value: SAMPLE_REQUEST_ITEMS.patternFullSize },
  { label: "报价核料", value: SAMPLE_REQUEST_ITEMS.quoteMaterialCheck },
  { label: "大货核料", value: SAMPLE_REQUEST_ITEMS.bulkMaterialCheck },
  { label: "充棉/绒量", value: SAMPLE_REQUEST_ITEMS.patternPaddingAmount },
  { label: "核拉链长度", value: SAMPLE_REQUEST_ITEMS.patternZipperLength },
  { label: "裁剪", value: SAMPLE_REQUEST_ITEMS.cutting }
];

export const intakeStatusOptions: Array<FormOption<IntakeStatus>> = [
  { label: "待接单", value: INTAKE_STATUSES.pendingReceive },
  { label: "已接单", value: INTAKE_STATUSES.received },
  { label: "待客户补充", value: INTAKE_STATUSES.needsClientSupplement }
];

export const orderStageOptions: Array<FormOption<OrderStage>> = [
  { label: "待接单", value: ORDER_STAGES.pendingReceive },
  { label: "待制版", value: ORDER_STAGES.patternWaiting },
  { label: "制版中", value: ORDER_STAGES.patternDoing },
  { label: "待裁剪", value: ORDER_STAGES.cuttingWaiting },
  { label: "裁剪中", value: ORDER_STAGES.cuttingDoing },
  { label: "待缝制", value: ORDER_STAGES.sewingWaiting },
  { label: "缝制中", value: ORDER_STAGES.sewingDoing },
  { label: "待组检/出库", value: ORDER_STAGES.qcDeliveryWaiting },
  { label: "已完成", value: ORDER_STAGES.done }
];

export const DEFAULT_SAMPLE_TYPE_CODES = {
  firstSample: "first_sample",
  fitSample: "fit_sample",
  revisionSample: "revision_sample",
  preProductionSample: "pre_production_sample"
} as const;

export type SampleType = string;

export const sampleTypeOptions: Array<FormOption<SampleType>> = [
  { label: "初样", value: DEFAULT_SAMPLE_TYPE_CODES.firstSample },
  { label: "试身样", value: DEFAULT_SAMPLE_TYPE_CODES.fitSample },
  { label: "修改样", value: DEFAULT_SAMPLE_TYPE_CODES.revisionSample },
  { label: "产前样", value: DEFAULT_SAMPLE_TYPE_CODES.preProductionSample }
];

export type SampleRound = "round_1" | "round_2" | "round_3" | "round_4";

export const sampleRoundOptions: Array<FormOption<SampleRound>> = [
  { label: "第 1 轮", value: "round_1" },
  { label: "第 2 轮", value: "round_2" },
  { label: "第 3 轮", value: "round_3" },
  { label: "第 4 轮", value: "round_4" }
];
