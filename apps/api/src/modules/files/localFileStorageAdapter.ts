import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  FileStorageNotFoundError,
  type FileStorageAdapter,
  type MoveFileInput,
  type SaveFileInput,
  type StoredFile,
  type StoredFileStat
} from "./fileStorageAdapter.js";
import { resolveSampleRoomStorageRoot } from "./storageConfig.js";
import { resolveOrderAttachmentDirectory } from "./orderAttachmentArchive.js";

function normalizeRoot(root: string | undefined) {
  return path.resolve(root && root.trim().length > 0 ? root : resolveSampleRoomStorageRoot());
}

export function sanitizeOriginalFileName(value: string) {
  const baseName = path.basename(value).replace(/[^\w.\-\u4e00-\u9fff]+/g, "_");
  const clean = baseName.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return clean.length > 0 ? clean.slice(0, 120) : "attachment.bin";
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function assertSafeStorageKey(storageKey: string) {
  if (
    storageKey.length === 0 ||
    path.isAbsolute(storageKey) ||
    storageKey.includes("\\") ||
    storageKey.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("storageKey is invalid.");
  }
}

export class LocalFileStorageAdapter implements FileStorageAdapter {
  readonly root: string;

  constructor(root?: string) {
    this.root = normalizeRoot(root);
  }

  private resolveStorageKey(storageKey: string) {
    assertSafeStorageKey(storageKey);
    const absolutePath = path.resolve(this.root, ...storageKey.split("/"));
    const relative = path.relative(this.root, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("storageKey is outside the storage root.");
    }

    return absolutePath;
  }

  async saveFile(input: SaveFileInput): Promise<StoredFile> {
    if ((!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) && !input.temporaryPath) {
      throw new Error("file content is required.");
    }
    if (!input.orderFolderRelativePath) throw new Error("A complete order folder is required.");

    const fileName = sanitizeOriginalFileName(input.originalName);
    const archiveSegments = resolveOrderAttachmentDirectory({
      orderFolderRelativePath: input.orderFolderRelativePath,
      category: input.category,
      uploaderRole: input.uploaderRole,
      businessLabel: input.businessLabel
    });
    const storageKey = [
      "Orders",
      ...archiveSegments,
      `${randomUUID()}-${fileName}`
    ].join("/");
    const absolutePath = this.resolveStorageKey(storageKey);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    let sizeBytes: number;
    let checksum: string;
    if (input.temporaryPath) {
      const temporaryRoot = path.resolve(this.root, ".tmp");
      const temporaryPath = path.resolve(input.temporaryPath);
      const relativeTemporaryPath = path.relative(temporaryRoot, temporaryPath);
      if (relativeTemporaryPath.startsWith("..") || path.isAbsolute(relativeTemporaryPath)) {
        throw new Error("temporary upload is outside the configured upload directory.");
      }
      sizeBytes = (await fs.stat(temporaryPath)).size;
      checksum = input.checksum ?? await sha256File(temporaryPath);
      await fs.rename(temporaryPath, absolutePath);
    } else {
      const buffer = input.buffer!;
      await fs.writeFile(absolutePath, buffer, { flag: "wx" });
      sizeBytes = buffer.length;
      checksum = input.checksum ?? sha256(buffer);
    }

    return {
      storageKey,
      originalName: input.originalName,
      contentType: input.contentType || "application/octet-stream",
      sizeBytes,
      checksum,
      createdAt: new Date().toISOString()
    };
  }

  async moveFile(input: MoveFileInput): Promise<string> {
    const sourcePath = this.resolveStorageKey(input.storageKey);
    const targetKey = [
      "Orders",
      ...resolveOrderAttachmentDirectory(input),
      path.basename(input.storageKey)
    ].join("/");
    if (targetKey === input.storageKey) return targetKey;
    const targetPath = this.resolveStorageKey(targetKey);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.rename(sourcePath, targetPath);
    return targetKey;
  }

  async readFile(storageKey: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.resolveStorageKey(storageKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new FileStorageNotFoundError(storageKey);
      }

      throw error;
    }
  }

  async statFile(storageKey: string): Promise<StoredFileStat> {
    try {
      const stat = await fs.stat(this.resolveStorageKey(storageKey));
      return {
        storageKey,
        sizeBytes: stat.size
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new FileStorageNotFoundError(storageKey);
      }

      throw error;
    }
  }

  async deleteFile(storageKey: string): Promise<void> {
    try {
      await fs.unlink(this.resolveStorageKey(storageKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }

      throw error;
    }
  }

  async fileExists(storageKey: string): Promise<boolean> {
    try {
      await fs.access(this.resolveStorageKey(storageKey));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }

      throw error;
    }
  }
}

export function createLocalFileStorageAdapter(env: NodeJS.ProcessEnv = process.env) {
  return new LocalFileStorageAdapter(resolveSampleRoomStorageRoot(env));
}
