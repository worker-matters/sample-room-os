import type { ReceiverQrPrintSettings } from "@sample-room/shared";
import { buildReceiverLabelPrintJob, type ReceiverLabelOrder } from "./receiverLabel";

export type PdfQrOrder = ReceiverLabelOrder;

const MM_TO_POINT = 72 / 25.4;
const A4_WIDTH = 210 * MM_TO_POINT;
const A4_HEIGHT = 297 * MM_TO_POINT;
const PAGE_MARGIN = 8 * MM_TO_POINT;

async function rasterizeLabel(
  label: ReturnType<typeof buildReceiverLabelPrintJob>["pages"][number],
  QRCode: { toCanvas: typeof import("qrcode").toCanvas }
) {
  if (typeof document === "undefined") return undefined;
  const pixelsPerMm = 12;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(label.widthMm * pixelsPerMm);
  canvas.height = Math.round(label.heightMm * pixelsPerMm);
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#111827";
  context.textBaseline = "top";
  for (const element of label.elements) {
    if (element.type === "qr") {
      const qrCanvas = document.createElement("canvas");
      await QRCode.toCanvas(qrCanvas, element.value, {
        width: Math.round(element.width * pixelsPerMm),
        margin: 1,
        errorCorrectionLevel: "M"
      });
      context.drawImage(
        qrCanvas,
        element.x * pixelsPerMm,
        element.y * pixelsPerMm,
        element.width * pixelsPerMm,
        element.height * pixelsPerMm
      );
      continue;
    }
    const fontSize = Math.max(10, element.fontSize * pixelsPerMm);
    context.font = `${element.bold ? 700 : 400} ${fontSize}px system-ui, sans-serif`;
    const maxWidth = element.width * pixelsPerMm;
    let value = element.value;
    while (value.length > 1 && context.measureText(value).width > maxWidth) {
      value = `${value.slice(0, -2)}…`;
    }
    context.fillText(value, element.x * pixelsPerMm, element.y * pixelsPerMm, maxWidth);
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
}

function pdfSafeText(value: string) {
  const translated = value
    .replace(/^客户：/, "Customer: ")
    .replace(/^业务员：/, "Sales: ")
    .replace(/^款号：/, "Style No: ")
    .replace(/^款名：/, "Style: ")
    .replace(/^样品类型：/, "Sample: ")
    .replace(/^数量：/, "Qty: ");
  return translated.replace(/[^\x20-\x7e]/g, "_");
}

export async function createOrderQrPdf(orders: PdfQrOrder[], settings: ReceiverQrPrintSettings) {
  if (orders.length === 0) throw new Error("没有可生成的二维码");
  const [{ PDFDocument, StandardFonts, rgb }, { default: QRCode }] = await Promise.all([
    import("pdf-lib"),
    import("qrcode")
  ]);
  const job = buildReceiverLabelPrintJob(settings, orders);
  const labels = Array.from({ length: job.copies }, () => job.pages).flat();
  const labelWidth = job.pages[0]!.widthMm * MM_TO_POINT;
  const labelHeight = job.pages[0]!.heightMm * MM_TO_POINT;
  const columns = Math.max(1, Math.floor((A4_WIDTH - PAGE_MARGIN * 2) / labelWidth));
  const rows = Math.max(1, Math.floor((A4_HEIGHT - PAGE_MARGIN * 2) / labelHeight));
  const labelsPerPage = columns * rows;
  const usedWidth = columns * labelWidth;
  const usedHeight = rows * labelHeight;
  const startX = (A4_WIDTH - usedWidth) / 2;
  const startY = A4_HEIGHT - (A4_HEIGHT - usedHeight) / 2;
  const document = await PDFDocument.create();
  const regularFont = await document.embedFont(StandardFonts.Helvetica);
  const boldFont = await document.embedFont(StandardFonts.HelveticaBold);

  for (let offset = 0; offset < labels.length; offset += labelsPerPage) {
    const page = document.addPage([A4_WIDTH, A4_HEIGHT]);
    const batch = labels.slice(offset, offset + labelsPerPage);
    for (const [index, label] of batch.entries()) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const labelX = startX + column * labelWidth;
      const labelTop = startY - row * labelHeight;
      page.drawRectangle({
        x: labelX,
        y: labelTop - labelHeight,
        width: labelWidth,
        height: labelHeight,
        borderColor: rgb(0.78, 0.81, 0.85),
        borderWidth: 0.35
      });
      const raster = await rasterizeLabel(label, QRCode);
      if (raster) {
        const image = await document.embedPng(raster);
        page.drawImage(image, {
          x: labelX,
          y: labelTop - labelHeight,
          width: labelWidth,
          height: labelHeight
        });
        continue;
      }
      for (const element of label.elements) {
        const x = labelX + element.x * MM_TO_POINT;
        const y = labelTop - (element.y + element.height) * MM_TO_POINT;
        if (element.type === "qr") {
          const dataUrl = await QRCode.toDataURL(element.value, {
            width: 512,
            margin: 1,
            errorCorrectionLevel: "M"
          });
          const image = await document.embedPng(
            Uint8Array.from(atob(dataUrl.split(",")[1]!), (character) => character.charCodeAt(0))
          );
          page.drawImage(image, {
            x,
            y,
            width: element.width * MM_TO_POINT,
            height: element.height * MM_TO_POINT
          });
        } else {
          const font = element.bold ? boldFont : regularFont;
          const size = element.fontSize * MM_TO_POINT;
          const maxWidth = element.width * MM_TO_POINT;
          let value = pdfSafeText(element.value);
          while (value.length > 1 && font.widthOfTextAtSize(value, size) > maxWidth) {
            value = `${value.slice(0, -2)}…`;
          }
          page.drawText(value.replace("…", "..."), { x, y, size, font, maxWidth });
        }
      }
    }
  }
  return new Blob([Uint8Array.from(await document.save()).buffer], { type: "application/pdf" });
}
