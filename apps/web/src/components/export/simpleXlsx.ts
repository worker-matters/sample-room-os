export type ExcelCellValue = string | number | boolean | null | undefined;

type ZipEntry = {
  name: string;
  bytes: Uint8Array;
};

type XlsxDataValidation = {
  range: string;
  list: string[];
};

export type XlsxOptions = {
  validations?: XlsxDataValidation[];
};

const encoder = new TextEncoder();

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index: number) {
  let name = "";
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function dataValidationsXml(validations: XlsxDataValidation[] = []) {
  if (validations.length === 0) {
    return "";
  }

  const validationXml = validations
    .map(
      (validation) =>
        `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${escapeXml(validation.range)}"><formula1>"${escapeXml(validation.list.join(","))}"</formula1></dataValidation>`
    )
    .join("");

  return `<dataValidations count="${validations.length}">${validationXml}</dataValidations>`;
}

function worksheetXml(rows: ExcelCellValue[][], options: XlsxOptions = {}) {
  const rowXml = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => {
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
          if (typeof cell === "number" && Number.isFinite(cell)) {
            return `<c r="${ref}"><v>${cell}</v></c>`;
          }

          if (typeof cell === "boolean") {
            return `<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`;
          }

          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(cell ?? ""))}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  const lastColumn = rows[0]?.length ? columnName(rows[0].length - 1) : "A";
  const lastRow = Math.max(rows.length, 1);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetData>${rowXml}</sheetData>
  ${dataValidationsXml(options.validations)}
</worksheet>`;
}

function workbookXml(sheetName: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
}

function uint16(value: number) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function uint32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concat(parts: Uint8Array[]) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function dosTimestamp(date = new Date()) {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const day = Math.max(date.getDate(), 1);
  const month = date.getMonth() + 1;
  const year = Math.max(date.getFullYear() - 1980, 0);
  const dosDate = (year << 9) | (month << 5) | day;
  return { time, date: dosDate };
}

function createZip(entries: ZipEntry[]) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const timestamp = dosTimestamp();

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const checksum = crc32(entry.bytes);
    const localHeader = concat([
      uint32(0x04034b50),
      uint16(20),
      uint16(0),
      uint16(0),
      uint16(timestamp.time),
      uint16(timestamp.date),
      uint32(checksum),
      uint32(entry.bytes.length),
      uint32(entry.bytes.length),
      uint16(name.length),
      uint16(0),
      name
    ]);

    const centralHeader = concat([
      uint32(0x02014b50),
      uint16(20),
      uint16(20),
      uint16(0),
      uint16(0),
      uint16(timestamp.time),
      uint16(timestamp.date),
      uint32(checksum),
      uint32(entry.bytes.length),
      uint32(entry.bytes.length),
      uint16(name.length),
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(0),
      uint32(offset),
      name
    ]);

    localParts.push(localHeader, entry.bytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + entry.bytes.length;
  }

  const centralDirectory = concat(centralParts);
  const end = concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(entries.length),
    uint16(entries.length),
    uint32(centralDirectory.length),
    uint32(offset),
    uint16(0)
  ]);

  return concat([...localParts, centralDirectory, end]);
}

export function createXlsxBlob(rows: ExcelCellValue[][], sheetName = "Orders", options: XlsxOptions = {}) {
  const safeSheetName = sheetName.replace(/[\\/?*\[\]:]/g, "").slice(0, 31) || "Orders";
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", bytes: encoder.encode(contentTypesXml()) },
    { name: "_rels/.rels", bytes: encoder.encode(rootRelsXml()) },
    { name: "xl/workbook.xml", bytes: encoder.encode(workbookXml(safeSheetName)) },
    { name: "xl/_rels/workbook.xml.rels", bytes: encoder.encode(workbookRelsXml()) },
    { name: "xl/worksheets/sheet1.xml", bytes: encoder.encode(worksheetXml(rows, options)) }
  ];

  const zip = createZip(entries);
  return new Blob([zip], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}
