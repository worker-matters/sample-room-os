import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(args, options = {}) {
  return spawn(npmCommand, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    ...options
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
}

const sharedBuild = run(["run", "build", "-w", "@sample-room/shared"]);
const buildResult = await waitForExit(sharedBuild);

if (buildResult.code !== 0) {
  process.exit(buildResult.code ?? 1);
}

const children = [
  run(["run", "dev", "-w", "@sample-room/api"]),
  run(["run", "dev", "-w", "@sample-room/web"])
];

let shuttingDown = false;

function stopChildren(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => process.exit(exitCode), 500).unref();
}

process.on("SIGINT", () => stopChildren(0));
process.on("SIGTERM", () => stopChildren(0));

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!shuttingDown && code !== 0 && signal !== "SIGTERM") {
      stopChildren(code ?? 1);
    }
  });
}
