import type { AttachmentMetadataInput } from "../api/sampleRoomApi";

export const MAX_ATTACHMENT_FILE_NAME_LENGTH = 120;

const invalidFileNameCharacterPattern = /[\\/:*?"<>|\u0000-\u001f]/u;

export type EditableAttachmentFileName = {
  baseName: string;
  extension: string;
};

export function splitAttachmentFileName(fileName: string): EditableAttachmentFileName {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return { baseName: fileName, extension: "" };
  }

  return {
    baseName: fileName.slice(0, dotIndex),
    extension: fileName.slice(dotIndex)
  };
}

function originalFileName(attachment: AttachmentMetadataInput) {
  return attachment.file?.name ?? attachment.fileName;
}

export function editableAttachmentFileName(
  attachment: AttachmentMetadataInput
): EditableAttachmentFileName {
  const { extension } = splitAttachmentFileName(originalFileName(attachment));
  const baseName =
    extension.length > 0 && attachment.fileName.endsWith(extension)
      ? attachment.fileName.slice(0, -extension.length)
      : attachment.fileName;

  return { baseName, extension };
}

export function validateAttachmentFileNameBody(baseName: string, extension: string) {
  const normalizedBaseName = baseName.trim();
  if (normalizedBaseName.length === 0) {
    return "文件名不能为空。";
  }
  if (normalizedBaseName === "." || normalizedBaseName === "..") {
    return "文件名不能使用路径符号。";
  }
  if (invalidFileNameCharacterPattern.test(normalizedBaseName)) {
    return "文件名不能包含 /、\\、:、*、?、\"、<、> 或 |。";
  }
  if (extension.length === 0 && normalizedBaseName.includes(".")) {
    return "原文件没有扩展名，文件名主体不能包含英文句点。";
  }
  if (normalizedBaseName.length + extension.length > MAX_ATTACHMENT_FILE_NAME_LENGTH) {
    return `文件名不能超过 ${MAX_ATTACHMENT_FILE_NAME_LENGTH} 个字符（含扩展名）。`;
  }

  return undefined;
}

export function attachmentFileNameError(attachment: AttachmentMetadataInput) {
  const { baseName, extension } = editableAttachmentFileName(attachment);
  return validateAttachmentFileNameBody(baseName, extension);
}

export function renameAttachmentFile(
  attachment: AttachmentMetadataInput,
  baseName: string
): AttachmentMetadataInput {
  const { extension } = splitAttachmentFileName(originalFileName(attachment));
  return {
    ...attachment,
    fileName: `${baseName}${extension}`
  };
}

export function normalizeAttachmentFileName(
  attachment: AttachmentMetadataInput
): AttachmentMetadataInput {
  const { baseName } = editableAttachmentFileName(attachment);
  return renameAttachmentFile(attachment, baseName.trim());
}
