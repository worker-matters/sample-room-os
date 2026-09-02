import { runLifecycleRepositoryContractSuite } from "../contracts/lifecycleRepositoryContractSuite.js";
import { createInMemoryLifecycleRepositorySet } from "./inMemoryLifecycleRepositories.js";

runLifecycleRepositoryContractSuite("in-memory lifecycle repository contract", () =>
  createInMemoryLifecycleRepositorySet()
);
