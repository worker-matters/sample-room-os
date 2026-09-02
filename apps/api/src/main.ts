import { createApp } from "./app.js";
import { createRuntimeLifecycleRepositorySet } from "./db/repositories/runtimeRepository.js";
import { storageStartupLines } from "./modules/files/storageConfig.js";
import { createLifecycleRunnerControlApp } from "./modules/lifecycle/lifecycleRunnerControlApp.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST?.trim() || "0.0.0.0";
const lifecycleRepositories = createRuntimeLifecycleRepositorySet();
const app = createApp({ lifecycleRepositories });

app.listen(port, host, () => {
  console.log(`sample-room-api-v2 listening on http://${host}:${port}`);
  for (const line of storageStartupLines()) {
    console.log(line);
  }
});

const runnerCredential = process.env.LIFECYCLE_RUNNER_TOKEN?.trim();
if (runnerCredential) {
  const runnerPort = Number(process.env.LIFECYCLE_RUNNER_PORT ?? 3002);
  createLifecycleRunnerControlApp({ repositories: lifecycleRepositories, machineCredential: runnerCredential }).listen(runnerPort, "0.0.0.0", () => {
    console.log(`lifecycle runner control listening on internal container port ${runnerPort}`);
  });
} else {
  console.warn("lifecycle runner control is disabled: LIFECYCLE_RUNNER_TOKEN is not configured");
}
