import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalFileStorageAdapter } from "./localFileStorageAdapter.js";
import { resolveOrderAttachmentDirectory } from "./orderAttachmentArchive.js";
import { maintainOrderIdentityMarkers } from "../patterns/localPatternFileWorkflow.js";

const relativePath = "客户/2026/Q3/业务员/SR001";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("order attachment archive", () => {
  it("maps public, thumbnail, pattern, charge, and unknown attachments under the full order path", () => {
    expect(resolveOrderAttachmentDirectory({ orderFolderRelativePath: relativePath, category: "style_thumbnail", uploaderRole: "receiver" })).toEqual([...relativePath.split("/"), "03_接单员"]);
    expect(resolveOrderAttachmentDirectory({ orderFolderRelativePath: relativePath, category: "client_upload", uploaderRole: "client_business_user" })).toEqual([...relativePath.split("/"), "01_客户", "客户资料"]);
    expect(resolveOrderAttachmentDirectory({ orderFolderRelativePath: relativePath, category: "material_consumption", uploaderRole: "pattern_maker" })).toEqual([...relativePath.split("/"), "02_版师", "核料"]);
    expect(resolveOrderAttachmentDirectory({ orderFolderRelativePath: relativePath, category: "pattern_file", uploaderRole: "pattern_maker", businessLabel: "pattern_making" })).toEqual([...relativePath.split("/"), "02_版师", "制版"]);
    expect(resolveOrderAttachmentDirectory({ orderFolderRelativePath: relativePath, category: "other", uploaderRole: "pattern_maker" })).toEqual([...relativePath.split("/"), "02_版师", "其他"]);
    expect(resolveOrderAttachmentDirectory({ orderFolderRelativePath: relativePath, category: "unknown", uploaderRole: "pattern_maker", businessLabel: "unknown" })).toEqual([...relativePath.split("/"), "02_版师", "未分类"]);
    expect(resolveOrderAttachmentDirectory({ orderFolderRelativePath: relativePath, category: "unknown", uploaderRole: "receiver" })).toEqual([...relativePath.split("/"), "03_接单员", "未分类"]);
    expect(resolveOrderAttachmentDirectory({ orderFolderRelativePath: relativePath, category: "order_charge", uploaderRole: "planner" })).toEqual([...relativePath.split("/"), "08_其他费用"]);
    expect(resolveOrderAttachmentDirectory({ orderFolderRelativePath: relativePath, category: "mystery" })).toEqual([...relativePath.split("/"), "07_其他附件"]);
  });

  it("moves a streamed temporary upload once and relocates sample-sheet state without a duplicate", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "archive-test-"));
    roots.push(root);
    const temporaryPath = path.join(root, ".tmp", "uploads", "server-uuid");
    await mkdir(path.dirname(temporaryPath), { recursive: true });
    await writeFile(temporaryPath, "streamed-content");
    const storage = new LocalFileStorageAdapter(root);
    const stored = await storage.saveFile({
      orderId: "order", orderFolderRelativePath: relativePath, category: "receiver_attachment",
      uploaderRole: "receiver", originalName: "same.txt", contentType: "text/plain", temporaryPath
    });
    expect(await storage.fileExists(stored.storageKey)).toBe(true);
    await expect(stat(temporaryPath)).rejects.toMatchObject({ code: "ENOENT" });
    const movedKey = await storage.moveFile({ storageKey: stored.storageKey, orderFolderRelativePath: relativePath, category: "receiver_sample_sheet", uploaderRole: "receiver" });
    expect(movedKey).toContain("/03_接单员/打样单/");
    expect(await storage.fileExists(stored.storageKey)).toBe(false);
    expect((await readFile(path.join(root, ...movedKey.split("/")), "utf8"))).toBe("streamed-content");
  });

  it("keeps a legacy cutting-named deliverable as one authoritative pattern-maker file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pattern-archive-test-"));
    roots.push(root);
    const temporaryPath = path.join(root, ".tmp", "uploads", "server-uuid");
    await mkdir(path.dirname(temporaryPath), { recursive: true });
    await writeFile(temporaryPath, "pattern-content");
    const storage = new LocalFileStorageAdapter(root);
    const stored = await storage.saveFile({
      orderId: "order",
      orderFolderRelativePath: relativePath,
      category: "cutting_pattern_file",
      uploaderRole: "pattern_maker",
      businessLabel: "pattern_making",
      originalName: "cutting-pattern.dxf",
      contentType: "application/octet-stream",
      temporaryPath
    });

    expect(stored.storageKey).toContain("/02_版师/制版/");
    expect(await storage.fileExists(stored.storageKey)).toBe(true);
    await expect(stat(path.join(root, "CuttingInbox"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(path.join(root, "Orders", ...relativePath.split("/"), "05_裁剪文件"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("order identity markers", () => {
  it("creates zero-byte deduplicated markers and precisely updates only obsolete names", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "marker-test-"));
    roots.push(root);
    await writeFile(path.join(root, "user-note.txt"), "keep");
    await maintainOrderIdentityMarkers({ rootPath: root, current: { styleNo: "Same", styleName: "same" } });
    expect((await readdir(root)).filter((name) => name.toLowerCase() === "same.txt")).toHaveLength(1);
    expect((await stat(path.join(root, "Same.txt"))).size).toBe(0);
    await maintainOrderIdentityMarkers({ rootPath: root, previous: { styleNo: "Same", styleName: "same" }, current: { styleNo: "B", styleName: "same" } });
    const names = await readdir(root);
    expect(names).toEqual(expect.arrayContaining(["B.txt", "Same.txt", "user-note.txt"]));
    expect(await readFile(path.join(root, "user-note.txt"), "utf8")).toBe("keep");
  });
});
