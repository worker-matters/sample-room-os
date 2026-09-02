import { extname } from "node:path";
import { HttpError } from "../../shared/errors/httpError.js";

const unsafeFileNameCharacters = /[<>:"/\\|?*\u0000-\u001f]/;
const reservedWindowsName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function renamedDisplayFileName(originalFileName: string, value: unknown) {
  if (typeof value !== "string") {
    throw new HttpError(400, "displayName must be a string.");
  }
  const displayName = value.trim();
  if (!displayName) throw new HttpError(400, "displayName is required.");
  if (displayName.length > 120) {
    throw new HttpError(400, "displayName must not exceed 120 characters.");
  }
  if (
    displayName === "." ||
    displayName === ".." ||
    displayName.includes("..") ||
    unsafeFileNameCharacters.test(displayName) ||
    reservedWindowsName.test(displayName) ||
    displayName.endsWith(".") ||
    displayName.endsWith(" ")
  ) {
    throw new HttpError(400, "displayName contains unsafe file-name characters.");
  }

  const extension = extname(originalFileName);
  if (!extension) {
    if (displayName.includes(".")) {
      throw new HttpError(400, "file extension cannot be changed.");
    }
    return displayName;
  }
  if (displayName.toLowerCase().endsWith(extension.toLowerCase())) {
    throw new HttpError(400, "edit only the file-name body; the extension is locked.");
  }
  return `${displayName}${extension}`;
}
