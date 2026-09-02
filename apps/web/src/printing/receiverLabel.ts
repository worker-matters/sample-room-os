import {
  RECEIVER_LABEL_PAPER_SIZE,
  RECEIVER_LABEL_TEMPLATES,
  receiverLabelCopies,
  selectedReceiverSavedLayout,
  type ReceiverLabelSummaryField,
  type ReceiverQrPrintSettings
} from "@sample-room/shared";

export type ReceiverLabelOrder = {
  orderId: string;
  scanValue: string;
  customerName: string;
  businessUserName: string;
  styleNo: string;
  styleName: string;
  sampleType: string;
  quantity: number;
};

export type ReceiverLabelElement =
  | {
      type: "qr";
      x: number;
      y: number;
      width: number;
      height: number;
      value: string;
    }
  | {
      type: "text";
      x: number;
      y: number;
      width: number;
      height: number;
      value: string;
      fontSize: number;
      bold?: boolean;
      multiline?: boolean;
    };

export type ReceiverLabelPage = {
  widthMm: number;
  heightMm: number;
  elements: ReceiverLabelElement[];
};

export type ReceiverLabelPrintJob = {
  schemaVersion: 1;
  printerModel: "B1";
  density: 3;
  labelType: 1;
  printMode: 1;
  copies: number;
  pages: ReceiverLabelPage[];
};

const fieldLabel: Record<ReceiverLabelSummaryField, string> = {
  customerName: "客户",
  businessUserName: "业务员",
  styleNo: "款号",
  styleName: "款名",
  sampleType: "样品类型",
  quantity: "数量"
};

function fieldValue(field: ReceiverLabelSummaryField, order: ReceiverLabelOrder, settings: ReceiverQrPrintSettings) {
  const value = field === "quantity" ? String(order.quantity) : order[field];
  if (field === "sampleType" && settings.sampleTypeDisplay === "truncate_8" && value.length > 8) {
    return `${value.slice(0, 8)}…`;
  }
  return value || "-";
}

function qrOnlyPage(order: ReceiverLabelOrder): ReceiverLabelPage {
  return {
    ...RECEIVER_LABEL_PAPER_SIZE[RECEIVER_LABEL_TEMPLATES.qrOnly33],
    elements: [{ type: "qr", x: 2, y: 2, width: 29, height: 29, value: order.scanValue }]
  };
}

function summaryPage(order: ReceiverLabelOrder, settings: ReceiverQrPrintSettings): ReceiverLabelPage {
  const size = RECEIVER_LABEL_PAPER_SIZE[RECEIVER_LABEL_TEMPLATES.summary50];
  if (!settings.showOrderSummary || settings.summaryFields.length === 0) {
    return {
      ...size,
      elements: [{
        type: "qr",
        x: settings.centerQrCode ? 4 : 2,
        y: 4,
        width: 42,
        height: 42,
        value: order.scanValue
      }]
    };
  }

  const fields = settings.summaryFields.slice(0, 6);
  const rowHeight = 40 / Math.max(fields.length, 1);
  return {
    ...size,
    elements: [
      { type: "qr", x: 2, y: 14, width: 21, height: 21, value: order.scanValue },
      ...fields.map<ReceiverLabelElement>((field, index) => ({
        type: "text",
        x: 25,
        y: 5 + index * rowHeight,
        width: 23,
        height: Math.min(6, rowHeight),
        value: `${fieldLabel[field]}：${fieldValue(field, order, settings)}`,
        fontSize: field === "styleNo" ? 2.7 : 2.4,
        bold: field === "styleNo"
      }))
    ]
  };
}

const freeformPlaceholderValues: Record<string, (order: ReceiverLabelOrder) => string> = {
  styleNo: (order) => order.styleNo || "-",
  styleName: (order) => order.styleName || "-",
  sampleType: (order) => order.sampleType || "-",
  quantity: (order) => String(order.quantity),
  customerName: (order) => order.customerName || "-",
  businessUserName: (order) => order.businessUserName || "-"
};

export function renderReceiverLabelSummaryText(template: string, order: ReceiverLabelOrder) {
  return template.replace(/{{(styleNo|styleName|sampleType|quantity|customerName|businessUserName)}}/g, (_match, key: string) =>
    freeformPlaceholderValues[key]!(order)
  );
}

function freeformPage(
  order: ReceiverLabelOrder,
  freeform: ReceiverQrPrintSettings["freeform"]
): ReceiverLabelPage {
  const widthMm = freeform.widthMm;
  const heightMm = freeform.heightMm;
  const qrX = freeform.qrBox.x * widthMm;
  const qrY = freeform.qrBox.y * heightMm;
  const qrSize = Math.min(
    freeform.qrBox.width * widthMm,
    freeform.qrBox.height * heightMm,
    widthMm - qrX,
    heightMm - qrY
  );
  const summaryX = freeform.summaryBox.x * widthMm;
  const summaryY = freeform.summaryBox.y * heightMm;
  const summaryWidth = Math.min(freeform.summaryBox.width * widthMm, widthMm - summaryX);
  const summaryHeight = Math.min(freeform.summaryBox.height * heightMm, heightMm - summaryY);
  const fontSizeMm = freeform.fontSizePt * 25.4 / 72;

  return {
    widthMm,
    heightMm,
    elements: [
      { type: "qr", x: qrX, y: qrY, width: qrSize, height: qrSize, value: order.scanValue },
      ...(freeform.showOrderSummary && freeform.summaryText.length > 0 ? [{
        type: "text" as const,
        x: summaryX,
        y: summaryY,
        width: summaryWidth,
        height: summaryHeight,
        value: renderReceiverLabelSummaryText(freeform.summaryText, order),
        fontSize: fontSizeMm,
        bold: freeform.bold,
        multiline: true
      }] : [])
    ]
  };
}

export function buildReceiverLabelPrintJob(
  settings: ReceiverQrPrintSettings,
  orders: ReceiverLabelOrder[]
): ReceiverLabelPrintJob {
  return {
    schemaVersion: 1,
    printerModel: "B1",
    density: 3,
    labelType: 1,
    printMode: 1,
    copies: receiverLabelCopies(settings),
    pages: orders.map((order) => {
      const savedLayout = selectedReceiverSavedLayout(settings);
      if (savedLayout) return freeformPage(order, savedLayout.settings);
      return settings.template === RECEIVER_LABEL_TEMPLATES.qrOnly33
        ? qrOnlyPage(order)
        : summaryPage(order, settings);
    })
  };
}
