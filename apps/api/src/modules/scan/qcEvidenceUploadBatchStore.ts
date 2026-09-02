import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpError } from "../../shared/errors/httpError.js";
import { maxAttachmentRequestBytes } from "../files/attachmentRouteUtils.js";
import { renamedDisplayFileName } from "../files/attachmentDisplayName.js";

export const maxQcEvidencePhotos = 10;
const defaultBatchTtlMs = 60 * 60 * 1000;
const batchIdPattern = /^[a-f0-9]{48}$/;

export type QcEvidenceBatchAction = "complete";

type UploadedQcEvidencePhoto = {
  fileName: string;
  mimeType: string;
  size: number;
  buffer?: Buffer | undefined;
  temporaryPath?: string | undefined;
};

type StoredPhoto = Omit<UploadedQcEvidencePhoto, "buffer"> & {
  storedFileName: string;
  category: QcEvidencePhotoCategory;
};

type QcEvidencePhotoCategory =
  | "qc_issue_photo"
  | "qc_sample_photo"
  | "qc_measurement_photo";

function qcEvidencePhotoCategory(value: unknown): QcEvidencePhotoCategory {
  if (value === undefined || value === null || value === "") return "qc_sample_photo";
  if (
    value === "qc_issue_photo" ||
    value === "qc_sample_photo" ||
    value === "qc_measurement_photo"
  ) return value;
  throw new HttpError(400, "invalid QC evidence photo category.");
}

type BatchMetadata = {
  id: string;
  scanTokenDigest: string;
  userId: string;
  action: QcEvidenceBatchAction;
  createdAt: string;
  expiresAt: string;
  totalBytes: number;
  photos: StoredPhoto[];
};

type BatchContext = {
  scanToken: string;
  userId: string;
  action: QcEvidenceBatchAction;
};

function tokenDigest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export class QcEvidenceUploadBatchStore {
  private readonly batchLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly rootDir = join(tmpdir(), "sample-room-qc-evidence-batches"),
    private readonly ttlMs = defaultBatchTtlMs,
    private readonly now = () => new Date()
  ) {}

  private batchDirectory(batchId: string) {
    if (!batchIdPattern.test(batchId)) {
      throw new HttpError(400, "invalid QC evidence upload batch.");
    }
    return join(this.rootDir, batchId);
  }

  private metadataPath(batchId: string) {
    return join(this.batchDirectory(batchId), "metadata.json");
  }

  private async readMetadata(batchId: string) {
    let metadata: BatchMetadata;
    try {
      metadata = JSON.parse(await readFile(this.metadataPath(batchId), "utf8")) as BatchMetadata;
    } catch {
      throw new HttpError(404, "QC evidence upload batch not found.");
    }
    if (new Date(metadata.expiresAt).getTime() <= this.now().getTime()) {
      await this.discard(batchId);
      throw new HttpError(410, "QC evidence upload batch expired.");
    }
    return metadata;
  }

  private verify(metadata: BatchMetadata, context: BatchContext) {
    if (
      metadata.scanTokenDigest !== tokenDigest(context.scanToken) ||
      metadata.userId !== context.userId ||
      metadata.action !== context.action
    ) {
      throw new HttpError(403, "QC evidence upload batch does not belong to this scan.");
    }
  }

  private async writeMetadata(metadata: BatchMetadata) {
    const directory = this.batchDirectory(metadata.id);
    const temporaryPath = join(directory, `metadata-${randomBytes(8).toString("hex")}.tmp`);
    await writeFile(temporaryPath, JSON.stringify(metadata), "utf8");
    await rename(temporaryPath, this.metadataPath(metadata.id));
  }

  private async withBatchLock<T>(batchId: string, task: () => Promise<T>) {
    const previous = this.batchLocks.get(batchId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.batchLocks.set(batchId, queued);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.batchLocks.get(batchId) === queued) {
        this.batchLocks.delete(batchId);
      }
    }
  }

  private async cleanupExpired() {
    await mkdir(this.rootDir, { recursive: true });
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    await Promise.all(entries.flatMap(async (entry) => {
      if (!entry.isDirectory() || !batchIdPattern.test(entry.name)) return [];
      try {
        const metadata = JSON.parse(
          await readFile(join(this.rootDir, entry.name, "metadata.json"), "utf8")
        ) as BatchMetadata;
        if (new Date(metadata.expiresAt).getTime() > this.now().getTime()) return [];
      } catch {
        // Invalid temporary batches are safe to remove because their directory names are generated here.
      }
      await rm(join(this.rootDir, entry.name), { recursive: true, force: true });
      return [];
    }));
  }

  async create(context: BatchContext) {
    await this.cleanupExpired();
    const id = randomBytes(24).toString("hex");
    const stagingDirectory = join(this.rootDir, `${id}.tmp-${randomBytes(8).toString("hex")}`);
    const createdAt = this.now();
    const metadata: BatchMetadata = {
      id,
      scanTokenDigest: tokenDigest(context.scanToken),
      userId: context.userId,
      action: context.action,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.ttlMs).toISOString(),
      totalBytes: 0,
      photos: []
    };
    await mkdir(stagingDirectory, { recursive: false });
    try {
      await writeFile(join(stagingDirectory, "metadata.json"), JSON.stringify(metadata), "utf8");
      await rename(stagingDirectory, this.batchDirectory(id));
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true });
      throw error;
    }
    return { id, expiresAt: metadata.expiresAt };
  }

  async actionFor(batchId: string, scanToken: string, userId: string) {
    const metadata = await this.readMetadata(batchId);
    if (metadata.scanTokenDigest !== tokenDigest(scanToken) || metadata.userId !== userId) {
      throw new HttpError(403, "QC evidence upload batch does not belong to this scan.");
    }
    return metadata.action;
  }

  async appendPhoto(
    batchId: string,
    context: BatchContext,
    photo: UploadedQcEvidencePhoto,
    displayName?: unknown,
    category?: unknown
  ) {
    return this.withBatchLock(batchId, async () => {
      const metadata = await this.readMetadata(batchId);
      this.verify(metadata, context);
      if (!photo.mimeType.startsWith("image/")) {
        throw new HttpError(400, "QC evidence files must be images.");
      }
      if (metadata.photos.length >= maxQcEvidencePhotos) {
        throw new HttpError(400, `at most ${maxQcEvidencePhotos} QC sample photos are allowed.`);
      }
      if (metadata.totalBytes + photo.size > maxAttachmentRequestBytes) {
        throw new HttpError(413, "QC evidence upload batch is too large.");
      }

      const normalizedCategory = qcEvidencePhotoCategory(category);
      const storedFileName = `${randomBytes(16).toString("hex")}.bin`;
      const fileName = displayName === undefined
        ? photo.fileName
        : renamedDisplayFileName(photo.fileName, displayName);
      const storedPath = join(this.batchDirectory(batchId), storedFileName);
      if (photo.temporaryPath) await rename(photo.temporaryPath, storedPath);
      else if (photo.buffer) await writeFile(storedPath, photo.buffer, { flag: "wx" });
      else throw new HttpError(400, "invalid QC sample photo.");
      metadata.photos.push({
        fileName,
        mimeType: photo.mimeType,
        size: photo.size,
        storedFileName,
        category: normalizedCategory
      });
      metadata.totalBytes += photo.size;
      await this.writeMetadata(metadata);
      return { count: metadata.photos.length, maxFiles: maxQcEvidencePhotos };
    });
  }

  async attachmentsForCompletion(batchId: string, context: BatchContext) {
    return this.withBatchLock(batchId, async () => {
      const metadata = await this.readMetadata(batchId);
      this.verify(metadata, context);
      if (metadata.photos.length === 0) {
        throw new HttpError(400, "at least one QC sample photo is required.");
      }
      return Promise.all(metadata.photos.map(async (photo) => ({
        fileName: photo.fileName,
        mimeType: photo.mimeType,
        size: photo.size,
        category: photo.category,
        temporaryPath: join(this.batchDirectory(batchId), photo.storedFileName)
      })));
    });
  }

  async discard(batchId: string) {
    await rm(this.batchDirectory(batchId), { recursive: true, force: true });
  }
}
