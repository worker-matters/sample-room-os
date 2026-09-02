import fs from "node:fs";
import path from "node:path";

const defaultFolderName = "SampleRoomV2Storage";

function windowsDriveRoot() {
  if (process.platform !== "win32") {
    return undefined;
  }

  return fs.existsSync("D:\\") ? "D:\\" : "C:\\";
}

export function defaultSampleRoomStorageRoot(env: NodeJS.ProcessEnv = process.env) {
  if (env.VITEST || env.NODE_ENV === "test") {
    return path.resolve(process.cwd(), ".tmp", "SampleRoomV2Storage-test");
  }

  const driveRoot = windowsDriveRoot();
  if (driveRoot) {
    return path.join(driveRoot, defaultFolderName);
  }

  return path.resolve(process.cwd(), ".tmp", defaultFolderName);
}

export function resolveSampleRoomStorageRoot(env: NodeJS.ProcessEnv = process.env) {
  return path.resolve(env.SAMPLE_ROOM_STORAGE_ROOT || defaultSampleRoomStorageRoot(env));
}

export function resolveSampleRoomOrdersRoot(env: NodeJS.ProcessEnv = process.env) {
  return path.resolve(
    env.SAMPLE_ROOM_ORDERS_ROOT ||
      env.SAMPLE_ROOM_ORDER_FOLDER_ROOT ||
      path.join(resolveSampleRoomStorageRoot(env), "Orders")
  );
}

export function resolveSampleRoomCuttingInboxRoot(env: NodeJS.ProcessEnv = process.env) {
  return path.resolve(
    env.SAMPLE_ROOM_CUTTING_INBOX_ROOT ||
      path.join(resolveSampleRoomStorageRoot(env), "CuttingInbox")
  );
}

export function storageStartupLines(env: NodeJS.ProcessEnv = process.env) {
  return [
    `当前文件存储根目录: ${resolveSampleRoomStorageRoot(env)}`,
    `当前订单文件夹根目录: ${resolveSampleRoomOrdersRoot(env)}`
  ];
}
