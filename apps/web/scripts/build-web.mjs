import { createHash } from "node:crypto";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(webRoot, "dist");
const workspaceNodeModules = path.resolve(webRoot, "../../node_modules");
const padUiManifestFileName = "pad-web-ui-manifest.json";

async function listBuildFiles(root, relative = "") {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.posix.join(relative.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) {
      files.push(...await listBuildFiles(root, child));
    } else if (entry.isFile() && child !== padUiManifestFileName) {
      files.push(child);
    }
  }
  return files.sort();
}

function automaticUiVersion(now) {
  const part = (value) => String(value).padStart(2, "0");
  return [
    now.getUTCFullYear(),
    part(now.getUTCMonth() + 1),
    part(now.getUTCDate()),
    `${part(now.getUTCHours())}${part(now.getUTCMinutes())}${part(now.getUTCSeconds())}`
  ].join(".");
}

export async function createPadUiManifest(root, now = new Date()) {
  const files = await Promise.all((await listBuildFiles(root)).map(async (filePath) => {
    const content = await readFile(path.join(root, ...filePath.split("/")));
    return {
      path: filePath,
      size: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex")
    };
  }));
  const bundleSha256 = createHash("sha256")
    .update(files.map((file) => `${file.path}\0${file.size}\0${file.sha256}`).join("\n"))
    .digest("hex");
  return {
    formatVersion: 1,
    uiVersion: automaticUiVersion(now),
    generatedAt: now.toISOString(),
    bundleSha256,
    downloadBasePath: "/api/tablet/web-ui/files/",
    files
  };
}

export function validateWebBuildEnvironment(env) {
  const authMode = env.VITE_AUTH_MODE;
  const devEntry = env.VITE_ENABLE_DEV_ENTRY;

  if (authMode !== "dev" && authMode !== "formal") {
    throw new Error('VITE_AUTH_MODE must be explicitly set to "dev" or "formal".');
  }
  if (devEntry !== "true" && devEntry !== "false") {
    throw new Error('VITE_ENABLE_DEV_ENTRY must be explicitly set to "true" or "false".');
  }
  if (authMode === "formal" && devEntry !== "false") {
    throw new Error('Formal Web builds require VITE_ENABLE_DEV_ENTRY="false".');
  }

  return { authMode, devEntryEnabled: devEntry === "true" };
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: webRoot,
    env,
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
  }
}

export async function buildWeb(env = process.env) {
  const releaseConfig = validateWebBuildEnvironment(env);

  await rm(distRoot, { recursive: true, force: true });
  run(
    process.execPath,
    [path.join(workspaceNodeModules, "typescript/bin/tsc"), "-p", "tsconfig.json"],
    env
  );
  run(
    process.execPath,
    [path.join(workspaceNodeModules, "vite/bin/vite.js"), "build"],
    env
  );
  await writeFile(
    path.join(distRoot, "release-config.json"),
    `${JSON.stringify({ formatVersion: 1, ...releaseConfig }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(distRoot, padUiManifestFileName),
    `${JSON.stringify(await createPadUiManifest(distRoot), null, 2)}\n`,
    "utf8"
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildWeb().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
