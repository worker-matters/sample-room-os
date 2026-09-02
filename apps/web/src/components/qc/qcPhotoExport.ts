import type { OrderAttachment } from "../../api/sampleRoomApi";

export type QcPhotoExportFormat = "image" | "pdf";

export type QcPhotoExportOrder = {
  styleNo: string;
  styleName: string;
  sampleType: string;
};

const cardWidth = 720;
const cardHeight = 960;

function safeFileName(value: string) {
  return value
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || "QC照片";
}

function sampleTypeLabel(value: string) {
  return ({
    initial: "初样",
    first_sample: "初样",
    repeat: "试身样",
    fit_sample: "试身样",
    revision_sample: "修改样",
    pre_production_sample: "产前样",
    sales_sample: "销售样"
  } as Record<string, string>)[value] ?? value;
}

function photoCategoryLabel(value: string) {
  if (value === "qc_measurement_photo") return "尺寸表照片";
  if (value === "qc_issue_photo") return "问题照片";
  return "样衣照片";
}

async function imageFromBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function cardPng(
  order: QcPhotoExportOrder,
  photo: OrderAttachment,
  blob: Blob,
  pageNo: number,
  total: number
) {
  const canvas = document.createElement("canvas");
  canvas.width = cardWidth;
  canvas.height = cardHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法生成导出文件");

  context.fillStyle = "#f2f5f9";
  context.fillRect(0, 0, cardWidth, cardHeight);
  context.fillStyle = "#ffffff";
  context.fillRect(8, 8, cardWidth - 16, cardHeight - 16);
  context.textAlign = "center";
  context.fillStyle = "#14233a";
  context.font = "bold 26px sans-serif";
  context.fillText(`${order.styleNo}  ${order.styleName}  ${sampleTypeLabel(order.sampleType)}`, cardWidth / 2, 54, cardWidth - 48);
  context.fillStyle = "#475569";
  context.font = "15px sans-serif";
  context.fillText(`导出时间：${new Date().toLocaleString("zh-CN")}`, cardWidth / 2, 82);
  context.fillStyle = "#0f172a";
  context.font = "bold 20px sans-serif";
  context.fillText(photoCategoryLabel(photo.category), cardWidth / 2, 116);

  const image = await imageFromBlob(blob);
  const box = { x: 24, y: 140, width: cardWidth - 48, height: cardHeight - 245 };
  context.fillStyle = "#f5f7fa";
  context.fillRect(box.x, box.y, box.width, box.height);
  const ratio = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
  const width = image.naturalWidth * ratio;
  const height = image.naturalHeight * ratio;
  context.drawImage(image, box.x + (box.width - width) / 2, box.y + (box.height - height) / 2, width, height);

  context.fillStyle = "#1e293b";
  context.font = "15px sans-serif";
  context.fillText(photo.fileName.slice(0, 48), cardWidth / 2, cardHeight - 62, cardWidth - 48);
  context.font = "14px sans-serif";
  context.fillText(`第 ${pageNo} 页 / 共 ${total} 页`, cardWidth / 2, cardHeight - 30);

  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error("照片导出生成失败")),
    "image/png"
  ));
}

export async function createQcPhotoExport(
  order: QcPhotoExportOrder,
  photos: OrderAttachment[],
  format: QcPhotoExportFormat,
  loadPhoto: (photo: OrderAttachment) => Promise<Blob>
) {
  if (photos.length === 0) throw new Error("当前记录没有可导出的照片");
  const sorted = [...photos].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const cards = await Promise.all(sorted.map(async (photo, index) => cardPng(
    order,
    photo,
    await loadPhoto(photo),
    index + 1,
    sorted.length
  )));
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  const baseName = safeFileName([order.styleNo, order.styleName, stamp].filter(Boolean).join("_"));

  if (format === "image") {
    const canvas = document.createElement("canvas");
    canvas.width = cardWidth;
    canvas.height = cardHeight * cards.length;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法生成导出文件");
    for (const [index, card] of cards.entries()) {
      context.drawImage(await imageFromBlob(card), 0, index * cardHeight);
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error("合并图片生成失败")),
      "image/png"
    ));
    return { blob, fileName: `${baseName}.png`, mimeType: "image/png" };
  }

  const { PDFDocument } = await import("pdf-lib");
  const pdfDocument = await PDFDocument.create();
  for (const card of cards) {
    const png = await pdfDocument.embedPng(await card.arrayBuffer());
    const page = pdfDocument.addPage([595, 842]);
    page.drawImage(png, { x: 0, y: 0, width: 595, height: 842 });
  }
  return {
    blob: new Blob([Uint8Array.from(await pdfDocument.save()).buffer], { type: "application/pdf" }),
    fileName: `${baseName}.pdf`,
    mimeType: "application/pdf"
  };
}
