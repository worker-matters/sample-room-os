import { createZipBuffer } from "./zipBuffer.js";

export type SimpleXlsxCell = string | number | boolean | null | undefined;

export type SimpleXlsxImage = {
  row: number;
  column: number;
  bytes: Buffer;
  extension: "png" | "jpeg";
  width: number;
  height: number;
  altText?: string;
};

export type SimpleXlsxCellStyle = {
  font?: {
    name?: string;
    size?: number;
    bold?: boolean;
    charset?: number;
  };
  border?: "thin";
  horizontalAlignment?: "general" | "center";
  verticalAlignment?: "top" | "center";
  wrapText?: boolean;
};

export type SimpleXlsxOptions = {
  sheetName?: string;
  columnWidths?: number[];
  rowHeights?: number[];
  images?: SimpleXlsxImage[];
  styles?: SimpleXlsxCellStyle[];
  cellStyleIds?: number[][];
};

function xml(value: string) {
  const xml10Text = Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0)!;
      return (
        codePoint === 0x09 ||
        codePoint === 0x0a ||
        codePoint === 0x0d ||
        (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
        (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
        (codePoint >= 0x10000 && codePoint <= 0x10ffff)
      );
    })
    .join("");
  return xml10Text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number) {
  let current = index + 1;
  let result = "";
  while (current > 0) {
    current -= 1;
    result = String.fromCharCode(65 + (current % 26)) + result;
    current = Math.floor(current / 26);
  }
  return result;
}

function cellXml(value: SimpleXlsxCell, column: number, row: number, styleId: number) {
  const reference = `${columnName(column)}${row + 1}`;
  if (value === null || value === undefined || value === "") {
    return `<c r="${reference}" s="${styleId}"/>`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}" s="${styleId}"><v>${value}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${reference}" s="${styleId}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${reference}" s="${styleId}" t="inlineStr"><is><t xml:space="preserve">${xml(String(value))}</t></is></c>`;
}

function stylesXml(styles: readonly SimpleXlsxCellStyle[]) {
  const fonts: Array<Required<Pick<NonNullable<SimpleXlsxCellStyle["font"]>, "name" | "size">> & {
    bold: boolean;
    charset?: number;
  }> = [{ name: "Calibri", size: 11, bold: false }];
  const fontIds = styles.map((style) => {
    const font = {
      name: style.font?.name ?? "Calibri",
      size: style.font?.size ?? 11,
      bold: style.font?.bold ?? false,
      ...(style.font?.charset === undefined ? {} : { charset: style.font.charset })
    };
    const existing = fonts.findIndex((candidate) =>
      candidate.name === font.name &&
      candidate.size === font.size &&
      candidate.bold === font.bold &&
      candidate.charset === font.charset
    );
    if (existing >= 0) return existing;
    fonts.push(font);
    return fonts.length - 1;
  });
  const usesThinBorder = styles.some((style) => style.border === "thin");
  const fontNodes = fonts.map((font) =>
    `<font>${font.bold ? "<b/>" : ""}<sz val="${font.size}"/><name val="${xml(font.name)}"/>` +
    `${font.charset === undefined ? "" : `<charset val="${font.charset}"/>`}</font>`
  ).join("");
  const borderNodes = `<border><left/><right/><top/><bottom/><diagonal/></border>` +
    (usesThinBorder
      ? `<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right>` +
        `<top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>`
      : "");
  const styleNodes = styles.map((style, index) => {
    const horizontal = style.horizontalAlignment && style.horizontalAlignment !== "general"
      ? ` horizontal="${style.horizontalAlignment}"`
      : "";
    const vertical = style.verticalAlignment ? ` vertical="${style.verticalAlignment}"` : "";
    const wrapText = style.wrapText ? ` wrapText="1"` : "";
    const alignment = horizontal || vertical || wrapText
      ? `<alignment${horizontal}${vertical}${wrapText}/>`
      : "";
    const fontId = fontIds[index] ?? 0;
    const borderId = style.border === "thin" ? 1 : 0;
    return `<xf numFmtId="0" fontId="${fontId}" fillId="0" borderId="${borderId}" xfId="0"` +
      `${fontId > 0 ? ` applyFont="1"` : ""}${borderId > 0 ? ` applyBorder="1"` : ""}` +
      `${alignment ? ` applyAlignment="1"` : ""}>${alignment}</xf>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="${fonts.length}">${fontNodes}</fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="${usesThinBorder ? 2 : 1}">${borderNodes}</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${styles.length + 1}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>${styleNodes}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;
}

export function simpleXlsxImageSize(
  bytes: Buffer,
  extension: SimpleXlsxImage["extension"]
): { width: number; height: number } | undefined {
  if (extension === "png") {
    if (
      bytes.length < 24 ||
      !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) return undefined;
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : undefined;
  }

  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) return undefined;
    const segmentLength = bytes.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) return undefined;
    if (startOfFrameMarkers.has(marker)) {
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    offset += 2 + segmentLength;
  }
  return undefined;
}

function imageDrawingXml(
  images: readonly SimpleXlsxImage[],
  columnWidths: readonly number[],
  rowHeights: readonly number[]
) {
  const pixelToEmu = 9525;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    images.map((image, index) => {
      const cellWidth = Math.max(1, (columnWidths[image.column] ?? 15) * 7 + 5);
      const cellHeight = Math.max(1, (rowHeights[image.row] ?? 66) * 96 / 72);
      const scale = Math.min((cellWidth - 8) / image.width, (cellHeight - 8) / image.height);
      const width = Math.max(1, image.width * scale);
      const height = Math.max(1, image.height * scale);
      const columnOffset = Math.max(0, (cellWidth - width) / 2) * pixelToEmu;
      const rowOffset = Math.max(0, (cellHeight - height) / 2) * pixelToEmu;
      const widthEmu = Math.round(width * pixelToEmu);
      const heightEmu = Math.round(height * pixelToEmu);
      return `<xdr:oneCellAnchor>` +
        `<xdr:from><xdr:col>${image.column}</xdr:col><xdr:colOff>${Math.round(columnOffset)}</xdr:colOff><xdr:row>${image.row}</xdr:row><xdr:rowOff>${Math.round(rowOffset)}</xdr:rowOff></xdr:from>` +
        `<xdr:ext cx="${widthEmu}" cy="${heightEmu}"/>` +
        `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${index + 1}" name="Picture ${index + 1}" descr="${xml(image.altText ?? "订单缩略图")}"/><xdr:cNvPicPr/></xdr:nvPicPr>` +
        `<xdr:blipFill><a:blip r:embed="rId${index + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>` +
        `<xdr:clientData/></xdr:oneCellAnchor>`;
    }).join("") +
    `</xdr:wsDr>`;
}

export function createSimpleXlsxBuffer(
  rows: readonly (readonly SimpleXlsxCell[])[],
  options: SimpleXlsxOptions = {}
) {
  const sheetName = (options.sheetName ?? "Sheet1").replace(/[\\/*?:[\]]/g, "_").slice(0, 31) || "Sheet1";
  const columnWidths = options.columnWidths ?? [];
  const rowHeights = options.rowHeights ?? [];
  const styles = options.styles ?? [{ verticalAlignment: "top", wrapText: true }];
  const cellStyleIds = options.cellStyleIds ?? [];
  const images = (options.images ?? []).filter((image) =>
    image.row >= 0 && image.column >= 0 && image.width > 0 && image.height > 0 && image.bytes.length > 0
  );
  const hasImages = images.length > 0;
  const columns = columnWidths.length > 0
    ? `<cols>${columnWidths.map((width, index) =>
      `<col min="${index + 1}" max="${index + 1}" width="${Math.max(1, width)}" customWidth="1"/>`
    ).join("")}</cols>`
    : "";
  const sheetRows = rows.map((row, rowIndex) => {
    const height = rowHeights[rowIndex];
    const heightAttributes = height ? ` ht="${height}" customHeight="1"` : "";
    return `<row r="${rowIndex + 1}"${heightAttributes}>${row.map((value, columnIndex) =>
      cellXml(
        value,
        columnIndex,
        rowIndex,
        Math.min(Math.max(cellStyleIds[rowIndex]?.[columnIndex] ?? 1, 0), styles.length)
      )
    ).join("")}</row>`;
  }).join("");

  const entries = [
    {
      name: "[Content_Types].xml",
      bytes: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `${images.some((image) => image.extension === "png") ? `<Default Extension="png" ContentType="image/png"/>` : ""}` +
        `${images.some((image) => image.extension === "jpeg") ? `<Default Extension="jpeg" ContentType="image/jpeg"/>` : ""}` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `${hasImages ? `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` : ""}` +
        `</Types>`
      )
    },
    {
      name: "_rels/.rels",
      bytes: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`
      )
    },
    {
      name: "xl/workbook.xml",
      bytes: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
      )
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      bytes: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`
      )
    },
    {
      name: "xl/styles.xml",
      bytes: Buffer.from(stylesXml(styles))
    },
    {
      name: "xl/worksheets/sheet1.xml",
      bytes: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"${hasImages ? ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"` : ""}>` +
        `${columns}<sheetData>${sheetRows}</sheetData>${hasImages ? `<drawing r:id="rId1"/>` : ""}</worksheet>`
      )
    },
    ...(hasImages ? [
      {
        name: "xl/worksheets/_rels/sheet1.xml.rels",
        bytes: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>` +
          `</Relationships>`
        )
      },
      {
        name: "xl/drawings/drawing1.xml",
        bytes: Buffer.from(imageDrawingXml(images, columnWidths, rowHeights))
      },
      {
        name: "xl/drawings/_rels/drawing1.xml.rels",
        bytes: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          images.map((image, index) =>
            `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${index + 1}.${image.extension}"/>`
          ).join("") +
          `</Relationships>`
        )
      },
      ...images.map((image, index) => ({
        name: `xl/media/image${index + 1}.${image.extension}`,
        bytes: image.bytes
      }))
    ] : [])
  ];

  return createZipBuffer(entries);
}
