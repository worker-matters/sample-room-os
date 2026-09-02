import { posix as path } from "node:path";
import { inflateRawSync } from "node:zlib";
import { HttpError } from "../../shared/errors/httpError.js";

const endOfCentralDirectorySignature = 0x06054b50;
const centralDirectorySignature = 0x02014b50;
const localFileSignature = 0x04034b50;
const maximumEntries = 128;
const maximumEntryBytes = 16 * 1024 * 1024;
const maximumTotalUncompressedBytes = 32 * 1024 * 1024;
const compressionRatioLimit = 100;
const compressionRatioMinimumBytes = 1024 * 1024;
const maximumWorksheetRows = 1001;
const maximumWorksheetColumns = 10;

type ZipEntry = {
  name: string;
  flags: number;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
};

function invalidWorkbook(message = "uploaded_file_is_not_a_safe_xlsx_workbook"): never {
  throw new HttpError(400, message);
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === endOfCentralDirectorySignature) return offset;
  }
  return invalidWorkbook();
}

function zipEntries(buffer: Buffer) {
  if (buffer.length < 22) return invalidWorkbook();
  const endOffset = findEndOfCentralDirectory(buffer);
  const disk = buffer.readUInt16LE(endOffset + 4);
  const centralDisk = buffer.readUInt16LE(endOffset + 6);
  const diskEntries = buffer.readUInt16LE(endOffset + 8);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  const commentLength = buffer.readUInt16LE(endOffset + 20);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== entryCount ||
    entryCount === 0 ||
    entryCount > maximumEntries ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    endOffset + 22 + commentLength !== buffer.length ||
    centralOffset + centralSize > endOffset
  ) {
    return invalidWorkbook();
  }

  const entries = new Map<string, ZipEntry>();
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > endOffset || buffer.readUInt32LE(offset) !== centralDirectorySignature) {
      return invalidWorkbook();
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const entryCommentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + entryCommentLength;
    if (
      nextOffset > endOffset ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff ||
      uncompressedSize > maximumEntryBytes ||
      (flags & 0x0001) !== 0 ||
      ![0, 8].includes(compression)
    ) {
      return invalidWorkbook();
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > maximumTotalUncompressedBytes) return invalidWorkbook();
    if (
      uncompressedSize >= compressionRatioMinimumBytes &&
      (compressedSize === 0 || uncompressedSize / compressedSize > compressionRatioLimit)
    ) {
      return invalidWorkbook("xlsx_compression_ratio_limit_exceeded");
    }

    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const name = rawName.replace(/\\/g, "/").replace(/^\/+/, "");
    const normalized = path.normalize(name);
    if (!name || normalized.startsWith("../") || path.isAbsolute(normalized) || entries.has(normalized)) {
      return invalidWorkbook();
    }
    entries.set(normalized, {
      name: normalized,
      flags,
      compression,
      compressedSize,
      uncompressedSize,
      localOffset
    });
    offset = nextOffset;
  }
  if (offset !== centralOffset + centralSize) return invalidWorkbook();
  return entries;
}

function extractEntry(buffer: Buffer, entry: ZipEntry) {
  const offset = entry.localOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== localFileSignature) {
    return invalidWorkbook();
  }
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (dataEnd > buffer.length) return invalidWorkbook();
  const compressed = buffer.subarray(dataOffset, dataEnd);
  let bytes: Buffer;
  try {
    bytes = entry.compression === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: maximumEntryBytes });
  } catch {
    return invalidWorkbook();
  }
  if (bytes.length !== entry.uncompressedSize) return invalidWorkbook();
  return bytes;
}

function attributes(value: string) {
  const result = new Map<string, string>();
  for (const match of value.matchAll(/([\w:.-]+)\s*=\s*["']([^"']*)["']/g)) {
    result.set(match[1]!, match[2]!);
  }
  return result;
}

function firstWorksheetName(buffer: Buffer, entries: Map<string, ZipEntry>) {
  const workbookEntry = entries.get("xl/workbook.xml");
  const relationshipsEntry = entries.get("xl/_rels/workbook.xml.rels");
  if (!workbookEntry || !relationshipsEntry) return invalidWorkbook();
  const workbook = extractEntry(buffer, workbookEntry).toString("utf8");
  const firstSheet = workbook.match(/<(?:\w+:)?sheet\b([^>]*)>/i);
  const relationshipId = firstSheet ? attributes(firstSheet[1]!).get("r:id") : undefined;
  if (!relationshipId) return invalidWorkbook();

  const relationships = extractEntry(buffer, relationshipsEntry).toString("utf8");
  for (const match of relationships.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/gi)) {
    const relation = attributes(match[1]!);
    if (
      relation.get("Id") === relationshipId &&
      relation.get("Type")?.endsWith("/worksheet")
    ) {
      const target = relation.get("Target");
      if (!target) return invalidWorkbook();
      const normalized = target.startsWith("/")
        ? path.normalize(target.slice(1))
        : path.normalize(path.join("xl", target));
      if (!normalized.startsWith("xl/") || normalized.includes("../")) return invalidWorkbook();
      return normalized;
    }
  }
  return invalidWorkbook();
}

function columnNumber(column: string) {
  let result = 0;
  for (const character of column.toUpperCase()) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  return result;
}

function assertCellReferenceWithinTemplate(reference: string) {
  const match = reference.replace(/\$/g, "").match(/^([A-Z]{1,3})(\d+)$/i);
  if (!match) return invalidWorkbook();
  const row = Number(match[2]);
  if (row > maximumWorksheetRows || columnNumber(match[1]!) > maximumWorksheetColumns) {
    throw new HttpError(413, "Excel import supports at most 1000 data rows and 10 columns.");
  }
}

function assertFirstWorksheetRange(worksheet: string) {
  const dimension = worksheet.match(/<(?:\w+:)?dimension\b[^>]*\bref\s*=\s*["']([^"']+)["']/i);
  if (dimension) {
    for (const reference of dimension[1]!.split(":")) {
      assertCellReferenceWithinTemplate(reference);
    }
  }

  const rows = Array.from(worksheet.matchAll(/<(?:\w+:)?row\b([^>]*)>/gi));
  if (rows.length > maximumWorksheetRows) {
    throw new HttpError(413, "Excel import supports at most 1000 data rows.");
  }
  for (const row of rows) {
    const rowNumber = attributes(row[1]!).get("r");
    if (rowNumber && Number(rowNumber) > maximumWorksheetRows) {
      throw new HttpError(413, "Excel import supports at most 1000 data rows.");
    }
  }
  for (const cell of worksheet.matchAll(/<(?:\w+:)?c\b([^>]*)>/gi)) {
    const reference = attributes(cell[1]!).get("r");
    if (reference) assertCellReferenceWithinTemplate(reference);
  }
}

export function assertSafeXlsxImport(buffer: Buffer) {
  const entries = zipEntries(buffer);
  const worksheetName = firstWorksheetName(buffer, entries);
  const worksheetEntry = entries.get(worksheetName);
  if (!worksheetEntry) return invalidWorkbook();
  assertFirstWorksheetRange(extractEntry(buffer, worksheetEntry).toString("utf8"));
}
