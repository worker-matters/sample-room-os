import { createHash, randomUUID } from "node:crypto";
import { createReadStream, mkdirSync } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import nodeApk from "node-apk";

const { Apk } = nodeApk;
import { ROLES } from "@sample-room/shared";
import type {
  OperationLogRepository,
  SystemSettingRepository
} from "../../db/repositories/contracts/index.js";
import { requireRoles, type CurrentUser } from "../auth/currentUser.js";
import { HttpError } from "../../shared/errors/httpError.js";

export type AndroidClientType = "phone" | "pad";

type ApkAnalysis = {
  packageName: string;
  versionCode: number;
  versionName: string;
  signerSha256: string[];
};

export type AndroidAppRelease = {
  id: string;
  clientType: AndroidClientType;
  packageName: string;
  versionCode: number;
  versionName: string;
  fileName: string;
  relativePath: string;
  sizeBytes: number;
  sha256: string;
  signerSha256: string[];
  releaseNotes?: string;
  publishedAt: string;
  publishedBy: string;
};

export type PublicAndroidAppRelease = Omit<
  AndroidAppRelease,
  "relativePath" | "publishedBy"
> & {
  downloadUrl: string;
};

type AndroidAppReleaseServiceOptions = {
  updateRoot: string;
  analyzeApk?: (filePath: string) => Promise<ApkAnalysis>;
};

const CLIENT_PACKAGE: Record<AndroidClientType, string> = {
  phone: "com.sampleroom.mobile",
  pad: "com.sampleroom.tablet"
};

const SETTING_KEYS: Record<AndroidClientType, string> = {
  phone: "android_app_release_v1_phone",
  pad: "android_app_release_v1_pad"
};

function requireSystemOwner(currentUser: CurrentUser) {
  if (currentUser.role !== ROLES.systemOwner) throw new HttpError(403, "forbidden");
}

function asClientType(value: unknown): AndroidClientType {
  if (value === "phone" || value === "pad") return value;
  throw new HttpError(400, "android_client_type_invalid");
}

function normalizeVersionCode(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, "apk_version_code_invalid");
  }
  return parsed;
}

function normalizeReleaseNotes(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > 1000) {
    throw new HttpError(400, "release_notes_too_long");
  }
  return normalized;
}

function hashBuffer(buffer: Uint8Array) {
  return createHash("sha256").update(buffer).digest("hex");
}

function hashFile(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function defaultAnalyzeApk(filePath: string): Promise<ApkAnalysis> {
  const apk = new Apk(filePath);
  try {
    const [manifest, certificates] = await Promise.all([
      apk.getManifestInfo(),
      apk.getCertificateInfo()
    ]);
    const packageName = String(manifest.package ?? "").trim();
    const versionName = String(manifest.versionName ?? "").trim();
    const versionCode = normalizeVersionCode(manifest.versionCode);
    const signerSha256 = certificates
      .map((certificate) => hashBuffer(certificate.bytes))
      .sort();

    if (!packageName || !versionName || signerSha256.length === 0) {
      throw new HttpError(400, "apk_metadata_incomplete");
    }

    return { packageName, versionCode, versionName, signerSha256 };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "apk_parse_failed");
  } finally {
    apk.close();
  }
}

function sameSignerSet(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function storedRelease(value: unknown, clientType: AndroidClientType): AndroidAppRelease | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<AndroidAppRelease>;
  if (
    record.clientType !== clientType ||
    record.packageName !== CLIENT_PACKAGE[clientType] ||
    typeof record.versionCode !== "number" ||
    typeof record.versionName !== "string" ||
    typeof record.fileName !== "string" ||
    typeof record.relativePath !== "string" ||
    typeof record.sizeBytes !== "number" ||
    typeof record.sha256 !== "string" ||
    !Array.isArray(record.signerSha256) ||
    typeof record.publishedAt !== "string" ||
    typeof record.publishedBy !== "string"
  ) {
    return undefined;
  }
  return record as AndroidAppRelease;
}

function publicRelease(release: AndroidAppRelease): PublicAndroidAppRelease {
  const { relativePath: _relativePath, publishedBy: _publishedBy, ...safe } = release;
  return {
    ...safe,
    downloadUrl: `/api/miniapp/app-releases/${release.clientType}/download`
  };
}

export class AndroidAppReleaseService {
  private readonly root: string;
  private readonly stagingRoot: string;
  private readonly analyzeApk: (filePath: string) => Promise<ApkAnalysis>;

  constructor(
    private readonly systemSettings: SystemSettingRepository,
    private readonly operationLogs: OperationLogRepository,
    options: AndroidAppReleaseServiceOptions
  ) {
    this.root = path.resolve(options.updateRoot, "android-apps");
    this.stagingRoot = path.join(this.root, "staging");
    this.analyzeApk = options.analyzeApk ?? defaultAnalyzeApk;
    mkdirSync(this.stagingRoot, { recursive: true });
    mkdirSync(path.join(this.root, "phone"), { recursive: true });
    mkdirSync(path.join(this.root, "pad"), { recursive: true });
  }

  stagingDirectory() {
    return this.stagingRoot;
  }

  async latest(clientTypeValue: unknown) {
    const clientType = asClientType(clientTypeValue);
    const record = await this.systemSettings.findSystemSetting(SETTING_KEYS[clientType]);
    return storedRelease(record?.value, clientType);
  }

  async latestPublic(clientTypeValue: unknown) {
    const release = await this.latest(clientTypeValue);
    return release ? publicRelease(release) : null;
  }

  async list(currentUser: CurrentUser) {
    requireSystemOwner(currentUser);
    const [phone, pad] = await Promise.all([this.latest("phone"), this.latest("pad")]);
    return {
      phone: phone ? publicRelease(phone) : null,
      pad: pad ? publicRelease(pad) : null
    };
  }

  async publish(
    currentUser: CurrentUser,
    clientTypeValue: unknown,
    upload: Pick<Express.Multer.File, "path" | "originalname" | "size">,
    releaseNotesValue: unknown
  ) {
    requireSystemOwner(currentUser);
    const clientType = asClientType(clientTypeValue);
    const expectedPackage = CLIENT_PACKAGE[clientType];
    const releaseNotes = normalizeReleaseNotes(releaseNotesValue);
    let moved = false;

    try {
      if (!upload.originalname.toLowerCase().endsWith(".apk")) {
        throw new HttpError(400, "apk_file_required");
      }

      const analysis = await this.analyzeApk(upload.path);
      if (analysis.packageName !== expectedPackage) {
        throw new HttpError(
          400,
          `apk_package_mismatch:${analysis.packageName || "unknown"}`
        );
      }

      const previous = await this.latest(clientType);
      if (previous && analysis.versionCode <= previous.versionCode) {
        throw new HttpError(
          409,
          `apk_version_code_must_increase:${previous.versionCode}`
        );
      }
      if (previous && !sameSignerSet(previous.signerSha256, analysis.signerSha256)) {
        throw new HttpError(409, "apk_signer_mismatch");
      }

      const sha256 = await hashFile(upload.path);
      const targetDirectory = path.join(this.root, clientType);
      const storedName = `${analysis.versionCode}-${randomUUID()}.apk`;
      const targetPath = path.join(targetDirectory, storedName);
      await rename(upload.path, targetPath);
      moved = true;

      const fileStat = await stat(targetPath);
      const release: AndroidAppRelease = {
        id: randomUUID(),
        clientType,
        packageName: analysis.packageName,
        versionCode: analysis.versionCode,
        versionName: analysis.versionName,
        fileName: upload.originalname,
        relativePath: path.relative(this.root, targetPath),
        sizeBytes: fileStat.size,
        sha256,
        signerSha256: analysis.signerSha256,
        ...(releaseNotes ? { releaseNotes } : {}),
        publishedAt: new Date().toISOString(),
        publishedBy: currentUser.accountId ?? currentUser.id
      };

      await this.systemSettings.upsertSystemSetting({
        key: SETTING_KEYS[clientType],
        value: release,
        updatedBy: currentUser.accountId ?? currentUser.id
      });

      await this.operationLogs.appendOperationLog({
        actorId: currentUser.accountId ?? currentUser.id,
        actorRole: currentUser.role,
        action: "android_app_release_published",
        targetType: "android_app_release",
        targetId: clientType,
        before: previous
          ? {
              versionCode: previous.versionCode,
              versionName: previous.versionName,
              sha256: previous.sha256
            }
          : {},
        after: {
          clientType,
          packageName: release.packageName,
          versionCode: release.versionCode,
          versionName: release.versionName,
          sha256: release.sha256
        }
      });

      if (previous?.relativePath) {
        const previousPath = path.resolve(this.root, previous.relativePath);
        if (previousPath.startsWith(`${this.root}${path.sep}`) && previousPath !== targetPath) {
          await rm(previousPath, { force: true }).catch(() => undefined);
        }
      }

      return publicRelease(release);
    } finally {
      if (!moved) {
        await rm(upload.path, { force: true }).catch(() => undefined);
      }
    }
  }

  async download(clientTypeValue: unknown) {
    const clientType = asClientType(clientTypeValue);
    const release = await this.latest(clientType);
    if (!release) throw new HttpError(404, "android_app_release_not_found");

    const absolutePath = path.resolve(this.root, release.relativePath);
    if (!absolutePath.startsWith(`${this.root}${path.sep}`)) {
      throw new HttpError(500, "android_app_release_path_invalid");
    }
    await stat(absolutePath).catch(() => {
      throw new HttpError(404, "android_app_release_file_missing");
    });
    return { release, absolutePath };
  }
}

export function createPublicAndroidAppReleaseRouter(service: AndroidAppReleaseService) {
  const router = Router();

  router.get("/app-releases/:clientType/latest", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ release: await service.latestPublic(req.params.clientType) });
  });

  router.get("/app-releases/:clientType/download", async (req, res, next) => {
    try {
      const { release, absolutePath } = await service.download(req.params.clientType);
      const safeFileName = path.basename(release.fileName).replace(/[^A-Za-z0-9._-]/g, "_");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", "application/vnd.android.package-archive");
      res.setHeader("Content-Length", String(release.sizeBytes));
      res.setHeader("Content-Disposition", `attachment; filename="${safeFileName}"`);

      const stream = createReadStream(absolutePath);
      stream.on("error", (error) => {
        if (!res.headersSent) {
          next(error);
          return;
        }
        res.destroy(error);
      });
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createSystemOwnerAndroidAppReleaseRouter(
  service: AndroidAppReleaseService,
  maxUploadBytes = 200 * 1024 * 1024
) {
  const router = Router();
  const upload = multer({
    storage: multer.diskStorage({
      destination: service.stagingDirectory(),
      filename: (_req, _file, callback) => callback(null, `${Date.now()}-${randomUUID()}.apk`)
    }),
    limits: { files: 1, fileSize: maxUploadBytes },
    fileFilter: (_req, file, callback) => {
      callback(null, file.originalname.toLowerCase().endsWith(".apk"));
    }
  });

  router.use(requireRoles(ROLES.systemOwner));

  router.get("/app-releases", async (req, res) => {
    res.json({ releases: await service.list(req.currentUser!) });
  });

  router.post("/app-releases", upload.single("apk"), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "apk_file_required", message: "请选择 APK 安装包。" });
      return;
    }
    res.status(201).json({
      release: await service.publish(
        req.currentUser!,
        req.body?.clientType,
        req.file,
        req.body?.releaseNotes
      )
    });
  });

  return router;
}
