import { describe, expect, it } from "vitest";
import { attachmentSelectionError } from "./ClientAttachmentPicker";

describe("attachment selection limits", () => {
  it("accepts a file of exactly 30 MiB", () => {
    expect(attachmentSelectionError([{ name: "exact.bin", size: 30 * 1024 * 1024 }]))
      .toBeUndefined();
  });

  it("explains the 30 MB per-file limit", () => {
    expect(attachmentSelectionError([{ name: "large.bin", size: 30 * 1024 * 1024 + 1 }])).toContain("超过单文件 30MB");
  });

  it("explains the 30-file cumulative selection limit", () => {
    expect(attachmentSelectionError(Array.from({ length: 31 }, (_, index) => ({ name: `${index}.txt`, size: 1 })))).toBe("一次最多选择 30 个附件。");
  });

  it("explains the simulated 300 MB aggregate limit without allocating file data", () => {
    expect(attachmentSelectionError(Array.from({ length: 11 }, (_, index) => ({ name: `${index}.bin`, size: 30 * 1024 * 1024 })))).toBe("已选附件总大小超过 300MB 限制。");
  });
});
