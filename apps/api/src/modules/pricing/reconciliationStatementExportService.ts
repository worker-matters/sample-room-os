import type { ReconciliationStatementRecord } from "./pricingTypes.js";
import { createZipBuffer } from "./zipBuffer.js";
import {
  createSimpleXlsxBuffer,
  type SimpleXlsxCellStyle,
  type SimpleXlsxImage
} from "./simpleXlsx.js";

const excelContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const zipContentType = "application/zip";

export type ReconciliationStatementDownload = {
  content: Buffer;
  contentType: string;
  fileName: string;
};

export const RECONCILIATION_STATEMENT_EXPORT_COLUMNS = [
  "orderCreatedDate",
  "deliveryDate",
  "thumbnail",
  "orderNo",
  "styleNo",
  "styleName",
  "sampleType",
  "sampleRound",
  "folderCode",
  "quantity",
  "quotedPrice",
  "sampleAmount",
  "customerPatternFee",
  "otherChargeTotal",
  "otherChargeNote",
  "receivableTotal"
] as const;
export type ReconciliationStatementExportColumn =
  (typeof RECONCILIATION_STATEMENT_EXPORT_COLUMNS)[number];

export const DEFAULT_RECONCILIATION_STATEMENT_EXPORT_COLUMNS: readonly ReconciliationStatementExportColumn[] = [
  "orderCreatedDate",
  "deliveryDate",
  "thumbnail",
  "styleNo",
  "styleName",
  "sampleType",
  "sampleRound",
  "quantity",
  "quotedPrice",
  "sampleAmount",
  "customerPatternFee",
  "otherChargeTotal",
  "otherChargeNote",
  "receivableTotal"
];

export type ReconciliationStatementItemExportContext = {
  orderCreatedAt?: string;
  deliveryCompletedAt?: string;
  sampleType?: string;
  sampleRound?: string;
  otherChargeNote?: string;
  thumbnail?: Omit<SimpleXlsxImage, "row" | "column">;
};

export type ReconciliationStatementExportContext = Record<
  string,
  ReconciliationStatementItemExportContext
>;

const statementColumnDefinitions: Record<
  ReconciliationStatementExportColumn,
  {
    label: string;
    width: number;
    value: (
      item: ReconciliationStatementRecord["items"][number],
      context?: ReconciliationStatementItemExportContext
    ) => string | number;
  }
> = {
  orderCreatedDate: {
    label: "接单日期",
    width: 14,
    value: (item, context) => dateCell(context?.orderCreatedAt ?? item.orderCreatedAt)
  },
  deliveryDate: {
    label: "交样日期",
    width: 14,
    value: (_item, context) => dateCell(context?.deliveryCompletedAt)
  },
  thumbnail: { label: "缩略图", width: 15, value: () => "" },
  orderNo: { label: "订单号", width: 24, value: (item) => item.orderNo },
  styleNo: { label: "款号", width: 20, value: (item) => item.styleNo },
  styleName: { label: "款名", width: 28, value: (item) => item.styleName },
  sampleType: { label: "样品类型", width: 14, value: (_item, context) => context?.sampleType ?? "" },
  sampleRound: { label: "轮次", width: 12, value: (_item, context) => context?.sampleRound ?? "" },
  folderCode: { label: "SR编号", width: 18, value: (item) => item.folderCode ?? "" },
  quantity: { label: "数量", width: 10, value: (item) => item.quantity },
  quotedPrice: { label: "样衣单价", width: 14, value: (item) => item.quotedPrice },
  sampleAmount: { label: "样衣总价", width: 14, value: (item) => item.sampleAmount },
  customerPatternFee: {
    label: "版费",
    width: 12,
    value: (item) => item.customerPatternFee ?? item.patternFeeTotal ?? 0
  },
  otherChargeTotal: { label: "其他费用", width: 14, value: (item) => item.otherChargeTotal },
  otherChargeNote: { label: "其他费用明细说明", width: 34, value: (item, context) => context?.otherChargeNote ?? item.otherChargeNote ?? "" },
  receivableTotal: { label: "应收总计", width: 14, value: (item) => item.receivableTotal }
};

const statementCellStyles: SimpleXlsxCellStyle[] = [
  { font: { name: "宋体", size: 12, bold: true, charset: 134 }, verticalAlignment: "top", wrapText: true },
  { font: { name: "Calibri", size: 12, bold: true, charset: 134 }, verticalAlignment: "top", wrapText: true },
  { font: { name: "宋体", size: 11, bold: true, charset: 134 }, border: "thin", horizontalAlignment: "center", verticalAlignment: "center", wrapText: true },
  { border: "thin", verticalAlignment: "top", wrapText: true },
  { border: "thin", horizontalAlignment: "center", verticalAlignment: "center", wrapText: true },
  { font: { name: "宋体", size: 11, bold: true, charset: 134 }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true },
  { horizontalAlignment: "center", verticalAlignment: "center", wrapText: true },
  { font: { name: "宋体", size: 11, charset: 134 }, horizontalAlignment: "center", verticalAlignment: "center" }
];

function dateOnly(value?: string) {
  return value ? new Date(value).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function dateCell(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function timeKey(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
}

export function safeFilenamePart(value: string | undefined, fallback: string) {
  const text = value?.trim() || fallback;
  return text.replace(/[\\/:*?"<>|]/g, "_");
}

export function statementExcelFileName(statement: ReconciliationStatementRecord) {
  const customer = safeFilenamePart(statement.customerName, "未知客户");
  const salesperson = safeFilenamePart(statement.salespersonName, "未知业务员");
  const statementNo = safeFilenamePart(statement.statementNo, "未知对账单");
  return `${customer}_${salesperson}_对账单_${statementNo}.xlsx`;
}

export function bulkStatementZipFileName(now = new Date()) {
  return `对账单批量下载_${dateOnly(now.toISOString())}_${timeKey(now)}.zip`;
}

function safeNumber(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function containsCjk(value: string) {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(value);
}

function statementInfoValueStyle(value: string) {
  return containsCjk(value) ? 1 : 2;
}

export function statementInfoRowHeight(
  value: string,
  columnWidth: number,
  firstWrappedLineHeight: number
) {
  const displayUnits = Array.from(value).reduce(
    (total, character) => total + (containsCjk(character) ? 2 : 1),
    0
  );
  const unitsPerLine = Math.max(6, Math.floor(columnWidth * 0.75));
  const lines = Math.max(1, Math.ceil(displayUnits / unitsPerLine));
  return lines <= 1 ? 22 : firstWrappedLineHeight + (lines - 2) * 15;
}

function statementRows(
  statement: ReconciliationStatementRecord,
  columns: readonly ReconciliationStatementExportColumn[],
  context: ReconciliationStatementExportContext
) {
  const effectiveItems = statement.items.filter((item) => !item.returnedAt);
  const itemRows = effectiveItems.map((item) =>
    columns.map((column) => statementColumnDefinitions[column].value(item, context[item.orderId]))
  );
  const quantityTotal = effectiveItems.reduce((sum, item) => sum + safeNumber(item.quantity), 0);
  const receivableTotal = effectiveItems.reduce((sum, item) => sum + safeNumber(item.receivableTotal), 0);

  return [
    ["对账单号", statement.statementNo],
    ["客户", statement.customerName || "未知客户"],
    ["业务员", statement.salespersonName || "未知业务员"],
    ["生成日期", dateOnly(statement.generatedAt)],
    ["账期", statement.billingPeriod],
    [],
    columns.map((column) => statementColumnDefinitions[column].label),
    ...itemRows,
    [],
    ...(columns.includes("quantity") ? [["样衣总件数", quantityTotal, "件"]] : []),
    ...(columns.includes("receivableTotal") ? [["应收合计", receivableTotal, "元"]] : [])
  ];
}

export function createStatementWorksheet(
  statement: ReconciliationStatementRecord,
  columns: readonly ReconciliationStatementExportColumn[] = DEFAULT_RECONCILIATION_STATEMENT_EXPORT_COLUMNS,
  context: ReconciliationStatementExportContext = {}
) {
  const rows = statementRows(statement, columns, context);
  const thumbnailColumn = columns.indexOf("thumbnail");
  const effectiveItems = statement.items.filter((item) => !item.returnedAt);
  const images: SimpleXlsxImage[] = thumbnailColumn < 0 ? [] : effectiveItems.flatMap((item, index) => {
    const thumbnail = context[item.orderId]?.thumbnail;
    return thumbnail ? [{ ...thumbnail, row: 7 + index, column: thumbnailColumn }] : [];
  });
  const columnWidths = columns.map((column) => statementColumnDefinitions[column].width);
  const infoColumnWidth = columnWidths[1] ?? 12;
  const customerName = statement.customerName || "未知客户";
  const salespersonName = statement.salespersonName || "未知业务员";
  const cellStyleIds = [
    [1, statementInfoValueStyle(statement.statementNo)],
    [1, statementInfoValueStyle(customerName)],
    [1, statementInfoValueStyle(salespersonName)],
    [1, 2],
    [1, statementInfoValueStyle(statement.billingPeriod)],
    [],
    columns.map(() => 3),
    ...effectiveItems.map(() => columns.map((column) => column === "thumbnail" ? 4 : 5)),
    [],
    ...(columns.includes("quantity") ? [[6, 7, 7]] : []),
    ...(columns.includes("receivableTotal") ? [[6, 7, 8]] : [])
  ];
  return {
    rows,
    "!cols": columnWidths.map((width) => ({ wch: width })),
    "!rows": rows.map((row, index) => ({
      hpt: index === 1
        ? statementInfoRowHeight(customerName, infoColumnWidth, 36)
        : index === 2
          ? statementInfoRowHeight(salespersonName, infoColumnWidth, 33)
          : images.some((image) => image.row === index)
            ? 66
            : row.some((cell) => typeof cell === "string" && cell.length > 18) || index === 0
              ? 26
              : 22
    })),
    "!images": images,
    "!styles": statementCellStyles,
    "!cellStyleIds": cellStyleIds,
    A1: { s: { alignment: { vertical: "top", wrapText: true } } }
  };
}

export function createStatementExcelBuffer(
  statement: ReconciliationStatementRecord,
  columns: readonly ReconciliationStatementExportColumn[] = DEFAULT_RECONCILIATION_STATEMENT_EXPORT_COLUMNS,
  context: ReconciliationStatementExportContext = {}
) {
  const worksheet = createStatementWorksheet(statement, columns, context);
  return createSimpleXlsxBuffer(worksheet.rows, {
    sheetName: "客户对账单",
    columnWidths: worksheet["!cols"].map((column) => column.wch),
    rowHeights: worksheet["!rows"].map((row) => row.hpt),
    images: worksheet["!images"],
    styles: worksheet["!styles"],
    cellStyleIds: worksheet["!cellStyleIds"]
  });
}

export function createStatementDownload(
  statements: ReconciliationStatementRecord[],
  columns: readonly ReconciliationStatementExportColumn[] = DEFAULT_RECONCILIATION_STATEMENT_EXPORT_COLUMNS,
  contexts: Record<string, ReconciliationStatementExportContext> = {}
): ReconciliationStatementDownload {
  if (statements.length === 1) {
    const statement = statements[0]!;
    return {
      content: createStatementExcelBuffer(statement, columns, contexts[statement.id]),
      contentType: excelContentType,
      fileName: statementExcelFileName(statement)
    };
  }

  const zip = createZipBuffer(
    statements.map((statement) => ({
      name: statementExcelFileName(statement),
      bytes: createStatementExcelBuffer(statement, columns, contexts[statement.id])
    }))
  );
  return {
    content: zip,
    contentType: zipContentType,
    fileName: bulkStatementZipFileName()
  };
}
