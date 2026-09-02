export const RECEIVER_LABEL_TEMPLATES = {
  qrOnly33: "qr_only_33",
  summary50: "summary_50"
} as const;

export type ReceiverLabelTemplate =
  (typeof RECEIVER_LABEL_TEMPLATES)[keyof typeof RECEIVER_LABEL_TEMPLATES];

export const RECEIVER_LABEL_SUMMARY_FIELDS = [
  "customerName",
  "businessUserName",
  "styleNo",
  "styleName",
  "sampleType",
  "quantity"
] as const;

export type ReceiverLabelSummaryField = (typeof RECEIVER_LABEL_SUMMARY_FIELDS)[number];

export type ReceiverLabelFreeformBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ReceiverLabelFreeformSettings = {
  widthMm: number;
  heightMm: number;
  showOrderSummary: boolean;
  summaryText: string;
  qrBox: ReceiverLabelFreeformBox;
  summaryBox: ReceiverLabelFreeformBox;
  fontSizePt: number;
  bold: boolean;
  copies: number;
};

export type ReceiverSavedLabelLayout = {
  id: string;
  name: string;
  settings: ReceiverLabelFreeformSettings;
};

export type ReceiverQrPrintSettings = {
  schemaVersion: 3;
  selectedLayoutId: string;
  template: ReceiverLabelTemplate;
  copies: number;
  summaryFields: ReceiverLabelSummaryField[];
  sampleTypeDisplay: "full" | "truncate_8";
  showOrderSummary: boolean;
  centerQrCode: boolean;
  freeform: ReceiverLabelFreeformSettings;
  savedLayouts: ReceiverSavedLabelLayout[];
};

export const DEFAULT_RECEIVER_LABEL_SUMMARY_TEXT = [
  "客户：{{customerName}}",
  "业务员：{{businessUserName}}",
  "款号：{{styleNo}}",
  "款名：{{styleName}}",
  "样品类型：{{sampleType}}",
  "数量：{{quantity}}"
].join("\n");

export const DEFAULT_RECEIVER_LABEL_FREEFORM_SETTINGS: ReceiverLabelFreeformSettings = {
  widthMm: 50,
  heightMm: 50,
  showOrderSummary: true,
  summaryText: DEFAULT_RECEIVER_LABEL_SUMMARY_TEXT,
  qrBox: { x: 0.06, y: 0.25, width: 0.42, height: 0.42 },
  summaryBox: { x: 0.52, y: 0.16, width: 0.43, height: 0.68 },
  fontSizePt: 10,
  bold: false,
  copies: 1
};

export const DEFAULT_RECEIVER_QR_PRINT_SETTINGS: ReceiverQrPrintSettings = {
  schemaVersion: 3,
  selectedLayoutId: RECEIVER_LABEL_TEMPLATES.qrOnly33,
  template: RECEIVER_LABEL_TEMPLATES.qrOnly33,
  copies: 1,
  summaryFields: [...RECEIVER_LABEL_SUMMARY_FIELDS],
  sampleTypeDisplay: "full",
  showOrderSummary: true,
  centerQrCode: true,
  freeform: {
    ...DEFAULT_RECEIVER_LABEL_FREEFORM_SETTINGS,
    qrBox: { ...DEFAULT_RECEIVER_LABEL_FREEFORM_SETTINGS.qrBox },
    summaryBox: { ...DEFAULT_RECEIVER_LABEL_FREEFORM_SETTINGS.summaryBox }
  },
  savedLayouts: []
};

export const RECEIVER_LABEL_PAPER_SIZE: Record<
  ReceiverLabelTemplate,
  { widthMm: 33 | 50; heightMm: 33 | 50 }
> = {
  [RECEIVER_LABEL_TEMPLATES.qrOnly33]: { widthMm: 33, heightMm: 33 },
  [RECEIVER_LABEL_TEMPLATES.summary50]: { widthMm: 50, heightMm: 50 }
};

function validSummaryFields(value: unknown): value is ReceiverLabelSummaryField[] {
  return Array.isArray(value) &&
    value.length <= RECEIVER_LABEL_SUMMARY_FIELDS.length &&
    value.every((field) => RECEIVER_LABEL_SUMMARY_FIELDS.includes(field as ReceiverLabelSummaryField)) &&
    new Set(value).size === value.length;
}

function finiteBetween(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function parseBox(value: unknown): ReceiverLabelFreeformBox | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const box = value as Record<string, unknown>;
  if (![box.x, box.y, box.width, box.height].every((part) => finiteBetween(part, 0, 1))) return undefined;
  const parsed = box as ReceiverLabelFreeformBox;
  if (parsed.width < 0.08 || parsed.height < 0.08) return undefined;
  if (parsed.x + parsed.width > 1.000001 || parsed.y + parsed.height > 1.000001) return undefined;
  return { x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height };
}

function summaryTextFromFields(value: unknown) {
  if (!validSummaryFields(value)) return undefined;
  return value.map((field) => `${fieldLabel[field]}：{{${field}}}`).join("\n");
}

const fieldLabel: Record<ReceiverLabelSummaryField, string> = {
  customerName: "客户",
  businessUserName: "业务员",
  styleNo: "款号",
  styleName: "款名",
  sampleType: "样品类型",
  quantity: "数量"
};

function parseFreeform(value: unknown, allowLegacyFields = false): ReceiverLabelFreeformSettings | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const qrBox = parseBox(input.qrBox);
  const summaryBox = parseBox(input.summaryBox);
  if (!finiteBetween(input.widthMm, 20, 50) || !finiteBetween(input.heightMm, 20, 200)) return undefined;
  if (typeof input.showOrderSummary !== "boolean") return undefined;
  const summaryText = typeof input.summaryText === "string"
    ? input.summaryText.replace(/\r\n?/g, "\n")
    : allowLegacyFields
      ? summaryTextFromFields(input.summaryFields)
      : undefined;
  if (summaryText === undefined || summaryText.length > 2_000) return undefined;
  if (!qrBox || !summaryBox) return undefined;
  if (!Number.isInteger(input.fontSizePt) || !finiteBetween(input.fontSizePt, 6, 18)) return undefined;
  if (typeof input.bold !== "boolean") return undefined;
  if (!Number.isInteger(input.copies) || !finiteBetween(input.copies, 1, 20)) return undefined;
  return {
    widthMm: input.widthMm as number,
    heightMm: input.heightMm as number,
    showOrderSummary: input.showOrderSummary,
    summaryText,
    qrBox,
    summaryBox,
    fontSizePt: input.fontSizePt as number,
    bold: input.bold,
    copies: input.copies as number
  };
}

function parseStandard(input: Record<string, unknown>): Pick<
  ReceiverQrPrintSettings,
  "template" | "copies" | "summaryFields" | "sampleTypeDisplay" | "showOrderSummary" | "centerQrCode"
> | undefined {
  const template = input.template;
  if (template !== RECEIVER_LABEL_TEMPLATES.qrOnly33 && template !== RECEIVER_LABEL_TEMPLATES.summary50) {
    return undefined;
  }
  if (!Number.isInteger(input.copies) || !finiteBetween(input.copies, 1, 20)) return undefined;
  if (!validSummaryFields(input.summaryFields)) return undefined;
  if (input.sampleTypeDisplay !== "full" && input.sampleTypeDisplay !== "truncate_8") return undefined;
  if (typeof input.showOrderSummary !== "boolean" || typeof input.centerQrCode !== "boolean") return undefined;
  return {
    template,
    copies: input.copies as number,
    summaryFields: [...input.summaryFields],
    sampleTypeDisplay: input.sampleTypeDisplay as ReceiverQrPrintSettings["sampleTypeDisplay"],
    showOrderSummary: input.showOrderSummary,
    centerQrCode: input.centerQrCode
  };
}

function parseSavedLayouts(value: unknown, allowLegacyFields = false): ReceiverSavedLabelLayout[] | undefined {
  if (!Array.isArray(value) || value.length > 12) return undefined;
  const parsed: ReceiverSavedLabelLayout[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
    const input = item as Record<string, unknown>;
    const settings = parseFreeform(input.settings, allowLegacyFields);
    if (typeof input.id !== "string" || !/^freeform-[a-z0-9_-]{1,80}$/.test(input.id)) return undefined;
    if (typeof input.name !== "string" || input.name.length < 1 || input.name.length > 80 || !settings) return undefined;
    parsed.push({ id: input.id, name: input.name, settings });
  }
  if (new Set(parsed.map((item) => item.id)).size !== parsed.length) return undefined;
  return parsed;
}

export function parseReceiverQrPrintSettings(value: unknown): ReceiverQrPrintSettings | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const standard = parseStandard(input);
  if (!standard) return undefined;

  if (input.schemaVersion === 1) {
    return {
      schemaVersion: 3,
      selectedLayoutId: standard.template,
      ...standard,
      freeform: cloneFreeform(DEFAULT_RECEIVER_LABEL_FREEFORM_SETTINGS),
      savedLayouts: []
    };
  }

  if (input.schemaVersion !== 2 && input.schemaVersion !== 3) return undefined;
  const allowLegacyFields = input.schemaVersion === 2;
  const freeform = parseFreeform(input.freeform, allowLegacyFields);
  const savedLayouts = parseSavedLayouts(input.savedLayouts, allowLegacyFields);
  if (!freeform || !savedLayouts || typeof input.selectedLayoutId !== "string") return undefined;
  const selectedIsBuiltin = input.selectedLayoutId === RECEIVER_LABEL_TEMPLATES.qrOnly33 ||
    input.selectedLayoutId === RECEIVER_LABEL_TEMPLATES.summary50;
  if (!selectedIsBuiltin && !savedLayouts.some((item) => item.id === input.selectedLayoutId)) return undefined;
  return {
    schemaVersion: 3,
    selectedLayoutId: input.selectedLayoutId,
    ...standard,
    freeform,
    savedLayouts
  };
}

export function cloneFreeform(settings: ReceiverLabelFreeformSettings): ReceiverLabelFreeformSettings {
  return {
    ...settings,
    qrBox: { ...settings.qrBox },
    summaryBox: { ...settings.summaryBox }
  };
}

export function receiverQrPrintSettingsOrDefault(value: unknown): ReceiverQrPrintSettings {
  return parseReceiverQrPrintSettings(value) ?? {
    ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
    summaryFields: [...DEFAULT_RECEIVER_QR_PRINT_SETTINGS.summaryFields],
    freeform: cloneFreeform(DEFAULT_RECEIVER_QR_PRINT_SETTINGS.freeform),
    savedLayouts: []
  };
}

export function selectedReceiverSavedLayout(settings: ReceiverQrPrintSettings) {
  return settings.savedLayouts.find((layout) => layout.id === settings.selectedLayoutId);
}

export function receiverLabelCopies(settings: ReceiverQrPrintSettings) {
  return selectedReceiverSavedLayout(settings)?.settings.copies ?? settings.copies;
}
