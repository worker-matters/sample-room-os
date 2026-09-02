import { environmentExample } from "./environment.example";
import { localEnvironment } from "./environment.local";

export const environment = {
  ...environmentExample,
  ...localEnvironment,
  // Keep production debug disabled. Local experiments must not commit a real endpoint.
  enableScanDebug: false
} as const;
