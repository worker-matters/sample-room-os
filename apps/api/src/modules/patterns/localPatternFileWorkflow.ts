import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  resolveSampleRoomCuttingInboxRoot,
  resolveSampleRoomOrdersRoot,
  resolveSampleRoomStorageRoot
} from "../files/storageConfig.js";
import type { OrderRecord } from "../orders/orderTypes.js";
import type { OrderFolderCreateInput } from "./patternTypes.js";

export type PatternFileRoots = {
  localFileRoot: string;
  orderFolderRoot: string;
  cuttingInboxRoot: string;
};

export const ORDER_FOLDER_SUBDIRS = {
  orderInfo: "00_订单信息",
  customerOriginal: "01_客户",
  measurement: "05_组检出库",
  materials: "06_面辅料记录",
  patternWork: "02_版师",
  cutting: "05_裁剪文件",
  samplePhoto: "05_组检出库",
  outbound: "05_组检出库",
  changeLog: "07_其他附件",
  other: "07_其他附件"
} as const;

export const NEW_ORDER_ARCHIVE_DIRS = [
  "01_客户", "02_版师", "03_接单员", "04_计划员",
  "05_组检出库", "06_面辅料记录", "07_其他附件", "08_其他费用"
] as const;

const windowsReservedNames = new Set([
  "CON", "PRN", "AUX", "NUL",
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`)
]);

export function safeOrderMarkerName(value: string | undefined) {
  let safe = (value ?? "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\.\./g, "_")
    .replace(/[ .]+$/g, "")
    .trim()
    .slice(0, 100) || "未命名";
  if (windowsReservedNames.has(safe.toUpperCase())) safe = `${safe}_`;
  return `${safe}.txt`;
}

function markerSet(styleNo: string | undefined, styleName: string | undefined) {
  const result = new Map<string, string>();
  for (const value of [styleNo, styleName]) {
    const name = safeOrderMarkerName(value);
    if (!result.has(name.toLowerCase())) result.set(name.toLowerCase(), name);
  }
  return result;
}

export async function maintainOrderIdentityMarkers(input: {
  rootPath: string;
  previous?: Pick<OrderRecord, "styleNo" | "styleName"> | undefined;
  current: Pick<OrderRecord, "styleNo" | "styleName">;
}) {
  await mkdir(input.rootPath, { recursive: true });
  const next = markerSet(input.current.styleNo, input.current.styleName);
  for (const name of next.values()) await writeFile(path.join(input.rootPath, name), Buffer.alloc(0));
  if (!input.previous) return;
  const previous = markerSet(input.previous.styleNo, input.previous.styleName);
  for (const [key, name] of previous) {
    if (next.has(key)) continue;
    try {
      await unlink(path.join(input.rootPath, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export function getPatternFileRoots(env: NodeJS.ProcessEnv = process.env): PatternFileRoots {
  const localFileRoot = path.resolve(
    env.SAMPLE_ROOM_LOCAL_FILE_ROOT ?? resolveSampleRoomStorageRoot(env)
  );
  return {
    localFileRoot,
    orderFolderRoot: resolveSampleRoomOrdersRoot(env),
    cuttingInboxRoot: resolveSampleRoomCuttingInboxRoot(env)
  };
}

export function sanitizePathSegment(value: string, fallback = "unknown") {
  const normalized = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "")
    .slice(0, 80);

  return normalized.length > 0 ? normalized : fallback;
}

function ensureChildPath(root: string, ...segments: string[]) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Resolved workflow path escaped the configured root.");
  }

  return target;
}

function orderDate(order: OrderRecord) {
  const parsed = new Date(order.createdAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function yearForOrder(order: OrderRecord) {
  return String(orderDate(order).getFullYear());
}

function quarterForOrder(order: OrderRecord) {
  return `Q${Math.floor(orderDate(order).getMonth() / 3) + 1}`;
}

function relativePathFromSegments(segments: string[]) {
  return segments.join("/");
}

function relativePathSegments(relativePath: string) {
  return relativePath.split(/[\\/]+/).filter(Boolean);
}

export function buildOrderFolderPaths(
  relativePath: string,
  roots: PatternFileRoots = getPatternFileRoots()
) {
  const rootPath = ensureChildPath(roots.orderFolderRoot, ...relativePathSegments(relativePath));
  const orderInfoPath = path.join(rootPath, ORDER_FOLDER_SUBDIRS.orderInfo);
  const patternWorkPath = path.join(rootPath, ORDER_FOLDER_SUBDIRS.patternWork);
  const cuttingPath = path.join(rootPath, ORDER_FOLDER_SUBDIRS.cutting);

  return {
    rootPath,
    orderInfoPath,
    patternWorkPath,
    markerWorkPath: patternWorkPath,
    submittedCuttingPath: patternWorkPath,
    measurementPath: path.join(rootPath, ORDER_FOLDER_SUBDIRS.measurement),
    samplePhotoPath: path.join(rootPath, ORDER_FOLDER_SUBDIRS.samplePhoto),
    outboundPhotoPath: path.join(rootPath, ORDER_FOLDER_SUBDIRS.outbound),
    oldVersionPath: path.join(rootPath, ORDER_FOLDER_SUBDIRS.changeLog),
    cuttingPath,
    readmePath: path.join(orderInfoPath, "订单信息.txt")
  };
}

export function withCurrentOrderFolderPaths(
  folder: OrderFolderCreateInput,
  roots: PatternFileRoots = getPatternFileRoots()
): OrderFolderCreateInput {
  const paths = buildOrderFolderPaths(folder.relativePath, roots);
  return {
    ...folder,
    rootPath: paths.rootPath,
    patternWorkPath: paths.patternWorkPath,
    markerWorkPath: paths.markerWorkPath,
    submittedCuttingPath: paths.submittedCuttingPath,
    measurementPath: paths.measurementPath,
    samplePhotoPath: paths.samplePhotoPath,
    outboundPhotoPath: paths.outboundPhotoPath,
    oldVersionPath: paths.oldVersionPath,
    readmePath: paths.readmePath
  };
}

export function buildOrderFolderInput(
  order: OrderRecord,
  createdBy: string,
  roots: PatternFileRoots = getPatternFileRoots()
): OrderFolderCreateInput {
  const year = yearForOrder(order);
  const quarter = quarterForOrder(order);
  const customerSegment = sanitizePathSegment(
    order.customerName || order.customerSnapshot?.name || order.customerId,
    "customer"
  );
  const salespersonSegment = sanitizePathSegment(
    order.salespersonName || order.clientUserSnapshot?.displayName || order.clientUserId,
    "salesperson"
  );
  const folderName = sanitizePathSegment(order.folderCode, order.id);
  const relativePath = relativePathFromSegments([
    customerSegment,
    year,
    quarter,
    salespersonSegment,
    folderName
  ]);
  const paths = buildOrderFolderPaths(relativePath, roots);

  return {
    orderId: order.id,
    year,
    customerSegment,
    folderName,
    rootPath: paths.rootPath,
    relativePath,
    displayPath: relativePath,
    patternWorkPath: paths.patternWorkPath,
    markerWorkPath: paths.markerWorkPath,
    submittedCuttingPath: paths.submittedCuttingPath,
    measurementPath: paths.measurementPath,
    samplePhotoPath: paths.samplePhotoPath,
    outboundPhotoPath: paths.outboundPhotoPath,
    oldVersionPath: paths.oldVersionPath,
    readmePath: paths.readmePath,
    createdBy
  };
}

export async function writeOrderInfoFile(
  order: OrderRecord,
  folder: Pick<
    OrderFolderCreateInput,
    "readmePath" | "rootPath" | "patternWorkPath" | "relativePath"
  >
) {
  await mkdir(path.dirname(folder.readmePath), { recursive: true });
  await writeFile(
    folder.readmePath,
    [
      `folderCode: ${order.folderCode}`,
      `客户: ${order.customerName}`,
      `业务员: ${order.salespersonName}`,
      `订单号: ${order.orderNo}`,
      `款号: ${order.styleNo}`,
      `客户款名: ${order.styleName}`,
      `数量: ${order.quantity}`,
      `样品类型: ${order.sampleType}`,
      `轮次: ${order.sampleRound}`,
      `创建时间: ${order.createdAt}`,
      `接单员: ${order.receivedBy ?? order.createdBy}`,
      `当前状态: ${order.stage ?? order.intakeStatus}`,
      `备注: ${order.remark ?? ""}`,
      `最近更新时间: ${order.updatedAt}`,
      `订单文件夹: ${folder.rootPath}`,
      `版子文件夹: ${folder.patternWorkPath}`,
      `相对路径: ${folder.relativePath}`,
      "",
      "说明: folderCode 永久不变；订单号、款号、款名等业务字段校正时只更新数据库、页面显示和本文件，不移动物理文件夹。"
    ].join("\n"),
    "utf8"
  );
}

export async function ensureOrderFolderOnDisk(
  order: OrderRecord,
  folder: OrderFolderCreateInput,
  existing = false
) {
  await mkdir(folder.rootPath, { recursive: true });
  if (!existing) {
    await Promise.all([
      ...NEW_ORDER_ARCHIVE_DIRS.map((subdir) => mkdir(path.join(folder.rootPath, subdir), { recursive: true })),
      mkdir(path.join(folder.rootPath, ORDER_FOLDER_SUBDIRS.orderInfo), { recursive: true })
    ]);
    await writeOrderInfoFile(order, folder);
  } else {
    try {
      await access(folder.readmePath);
      await writeOrderInfoFile(order, folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  try {
    await maintainOrderIdentityMarkers({ rootPath: folder.rootPath, current: order });
  } catch (error) {
    console.error("order identity marker maintenance failed", { orderId: order.id, error: error instanceof Error ? error.message : "unknown_error" });
  }
}

export function buildSubmittedCuttingVersionPaths(
  orderFolder: Pick<OrderFolderCreateInput, "submittedCuttingPath" | "relativePath">,
  version: string,
  roots: PatternFileRoots = getPatternFileRoots()
) {
  const safeVersion = sanitizePathSegment(version, "version");
  return {
    submittedCuttingPath: path.join(orderFolder.submittedCuttingPath, safeVersion),
    cuttingInboxPath: ensureChildPath(
      roots.cuttingInboxRoot,
      ...relativePathSegments(orderFolder.relativePath),
      safeVersion
    )
  };
}

export async function ensureSubmittedCuttingFolders(paths: {
  submittedCuttingPath: string;
  cuttingInboxPath: string;
}) {
  await Promise.all([
    mkdir(paths.submittedCuttingPath, { recursive: true }),
    mkdir(paths.cuttingInboxPath, { recursive: true })
  ]);
}
