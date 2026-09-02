import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFileStorageAdapter } from "./localFileStorageAdapter.js";

describe("LocalFileStorageAdapter", () => {
  let root: string;
  let storage: LocalFileStorageAdapter;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "sample-room-file-storage-"));
    storage = new LocalFileStorageAdapter(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("saves, reads, stats, and deletes file bytes under the storage root", async () => {
    const content = Buffer.from("hello attachment storage", "utf8");
    const stored = await storage.saveFile({
      orderId: "order-1",
      folderCode: "SR20260618001",
      orderFolderRelativePath: "测试客户A/2026/Q2/业务员A/SR20260618001",
      category: "client_reference",
      uploaderRole: "client_business_user",
      originalName: "../dangerous name.txt",
      contentType: "text/plain",
      buffer: content
    });

    expect(stored.storageKey).toMatch(
      /^Orders\/测试客户A\/2026\/Q2\/业务员A\/SR20260618001\/01_客户\/客户资料\//
    );
    expect(stored.storageKey).not.toContain("..");
    expect(stored.sizeBytes).toBe(content.length);
    expect(stored.checksum).toHaveLength(64);
    await expect(storage.fileExists(stored.storageKey)).resolves.toBe(true);
    await expect(storage.readFile(stored.storageKey)).resolves.toEqual(content);
    await expect(storage.statFile(stored.storageKey)).resolves.toMatchObject({
      storageKey: stored.storageKey,
      sizeBytes: content.length
    });

    await storage.deleteFile(stored.storageKey);
    await expect(storage.fileExists(stored.storageKey)).resolves.toBe(false);
  });

  it("rejects traversal and absolute storage keys", async () => {
    await expect(storage.readFile("../outside.txt")).rejects.toThrow("storageKey is invalid");
    await expect(storage.fileExists("orders/../outside.txt")).rejects.toThrow("storageKey is invalid");
    await expect(storage.statFile(path.resolve(root, "outside.txt"))).rejects.toThrow(
      "storageKey is invalid"
    );
  });
});
