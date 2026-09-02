import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const trackedFiles = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split(/\r?\n/)
  .map((value) => value.trim())
  .filter((value) => value && existsSync(path.join(root, value)));

const conflictMarker = /^(<<<<<<< |>>>>>>> )/m;
const textExtensions = new Set([
  ".cjs", ".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".ps1", ".psm1", ".ts", ".tsx", ".yml", ".yaml"
]);
const failures = [];

for (const relative of trackedFiles) {
  const extension = path.extname(relative).toLowerCase();
  if (!textExtensions.has(extension)) continue;
  const content = readFileSync(path.join(root, relative), "utf8").replace(/^\uFEFF/, "");
  if (conflictMarker.test(content)) failures.push(`${relative}: unresolved merge-conflict marker`);

  if (extension === ".json") {
    try {
      JSON.parse(content);
    } catch (error) {
      failures.push(`${relative}: invalid JSON (${error.message})`);
    }
  }
}

for (const relative of trackedFiles.filter((file) => [".js", ".mjs", ".cjs"].includes(path.extname(file).toLowerCase()))) {
  try {
    execFileSync(process.execPath, ["--check", relative], { cwd: root, stdio: "pipe" });
  } catch (error) {
    failures.push(`${relative}: Node syntax check failed\n${error.stderr?.toString() ?? error.message}`);
  }
}

// Do not parse every historical PowerShell script here. This repository contains legacy scripts
// with mixed PowerShell-version requirements; the production lifecycle scripts are already parsed
// by their focused Vitest coverage. Keeping lint to deterministic repository hygiene prevents
// unrelated legacy files from making every PR fail while typecheck/test/build still gate changes.
if (failures.length > 0) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log(`Lint passed for ${trackedFiles.length} tracked files.`);
