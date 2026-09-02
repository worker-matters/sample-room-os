import { describe, expect, it } from "vitest";
import { readSheet } from "read-excel-file/node";
import { HttpError } from "../../shared/errors/httpError.js";
import { createSimpleXlsxBuffer } from "../pricing/simpleXlsx.js";
import { createZipBuffer } from "../pricing/zipBuffer.js";
import { assertSafeXlsxImport } from "./xlsxImportSafety.js";

function workbookWithWorksheet(worksheet: string) {
  return createZipBuffer([
    { name: "[Content_Types].xml", bytes: Buffer.from("<Types/>") },
    {
      name: "xl/workbook.xml",
      bytes: Buffer.from(
        '<workbook xmlns:r="urn:test"><sheets><sheet name="Import" sheetId="1" r:id="rId1"/></sheets></workbook>'
      )
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      bytes: Buffer.from(
        '<Relationships><Relationship Id="rId1" Type="urn:test/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
      )
    },
    { name: "xl/worksheets/sheet1.xml", bytes: Buffer.from(worksheet) }
  ]);
}

function patchCentralSizes(buffer: Buffer, sizes: Array<{ compressed: number; uncompressed: number }>) {
  const result = Buffer.from(buffer);
  let offset = 0;
  for (const size of sizes) {
    offset = result.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset);
    if (offset < 0) throw new Error("central directory entry not found");
    result.writeUInt32LE(size.compressed, offset + 20);
    result.writeUInt32LE(size.uncompressed, offset + 24);
    offset += 46;
  }
  return result;
}

describe("XLSX import ZIP preflight", () => {
  it("accepts the fixed template with 1000 data rows", () => {
    const rows = [
      Array.from({ length: 10 }, (_, index) => `header-${index}`),
      ...Array.from({ length: 1000 }, (_, row) => [`style-${row}`])
    ];
    expect(() => assertSafeXlsxImport(createSimpleXlsxBuffer(rows))).not.toThrow();
  });

  it("keeps generated XLSX valid when source text contains XML 1.0 control characters", async () => {
    const buffer = createSimpleXlsxBuffer([["safe\u0000text"]]);
    await expect(readSheet(buffer, 1)).resolves.toEqual([["safetext"]]);
  });

  it("rejects 1001 data rows and a huge sparse row before worksheet parsing", () => {
    const tooManyRows = Array.from({ length: 1002 }, (_, row) => [`row-${row}`]);
    expect(() => assertSafeXlsxImport(createSimpleXlsxBuffer(tooManyRows)))
      .toThrowError(HttpError);
    expect(() => assertSafeXlsxImport(workbookWithWorksheet(
      '<worksheet><sheetData><row r="1000000"><c r="A1000000"/></row></sheetData></worksheet>'
    ))).toThrowError(HttpError);
  });

  it("rejects abnormal compression metadata and excessive declared expansion", () => {
    const normal = workbookWithWorksheet(
      '<worksheet><sheetData><row r="1"><c r="A1"/></row></sheetData></worksheet>'
    );
    expect(() => assertSafeXlsxImport(patchCentralSizes(normal, [
      { compressed: 100, uncompressed: 2 * 1024 * 1024 }
    ]))).toThrowError("xlsx_compression_ratio_limit_exceeded");
    expect(() => assertSafeXlsxImport(patchCentralSizes(normal, [
      { compressed: 12 * 1024 * 1024, uncompressed: 12 * 1024 * 1024 },
      { compressed: 12 * 1024 * 1024, uncompressed: 12 * 1024 * 1024 },
      { compressed: 12 * 1024 * 1024, uncompressed: 12 * 1024 * 1024 }
    ]))).toThrowError(HttpError);
  });
});
