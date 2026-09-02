import { describe, expect, it } from "vitest";
import type { AttachmentMetadataInput } from "../api/sampleRoomApi";
import {
  MAX_ATTACHMENT_FILE_NAME_LENGTH,
  attachmentFileNameError,
  editableAttachmentFileName,
  normalizeAttachmentFileName,
  renameAttachmentFile,
  validateAttachmentFileNameBody
} from "./attachmentFileName";

function attachment(fileName: string): AttachmentMetadataInput {
  return {
    fileName,
    mimeType: "image/jpeg",
    size: 10,
    category: "receiver_material_record",
    visibility: "internal_only"
  };
}

describe("editable material-record filenames", () => {
  it("edits only the filename body and preserves the original extension", () => {
    const original = attachment("camera-123.jpg");
    const renamed = renameAttachmentFile(original, "蓝色主布到货记录");

    expect(renamed.fileName).toBe("蓝色主布到货记录.jpg");
    expect(editableAttachmentFileName(renamed)).toEqual({
      baseName: "蓝色主布到货记录",
      extension: ".jpg"
    });
    expect(renamed.mimeType).toBe(original.mimeType);
    expect(renamed.category).toBe("receiver_material_record");
    expect(renamed.visibility).toBe("internal_only");
  });

  it("rejects blank, path-like, and overlong filename bodies", () => {
    expect(validateAttachmentFileNameBody("   ", ".jpg")).toBe("文件名不能为空。");
    expect(validateAttachmentFileNameBody("..", ".jpg")).toContain("路径符号");
    expect(validateAttachmentFileNameBody("../面料", ".jpg")).toContain("不能包含");
    expect(validateAttachmentFileNameBody("面料/到货", ".jpg")).toContain("不能包含");
    expect(
      validateAttachmentFileNameBody(
        "a".repeat(MAX_ATTACHMENT_FILE_NAME_LENGTH),
        ".jpg"
      )
    ).toContain(`${MAX_ATTACHMENT_FILE_NAME_LENGTH}`);
  });

  it("does not allow an extensionless original file to gain an extension", () => {
    expect(validateAttachmentFileNameBody("material.exe", "")).toContain("没有扩展名");
  });

  it("normalizes surrounding spaces and keeps multiple attachment names independent", () => {
    const files = [attachment("camera-a.jpg"), attachment("camera-b.png")];
    const renamed = [
      renameAttachmentFile(files[0]!, "  蓝色主布  "),
      renameAttachmentFile(files[1]!, "白色纽扣")
    ].map(normalizeAttachmentFileName);

    expect(renamed.map((item) => item.fileName)).toEqual([
      "蓝色主布.jpg",
      "白色纽扣.png"
    ]);
    expect(attachmentFileNameError(renamed[0]!)).toBeUndefined();
    expect(attachmentFileNameError(renamed[1]!)).toBeUndefined();
  });
});
