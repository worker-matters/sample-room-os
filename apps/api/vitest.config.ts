import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./src/test/setupWindowsPowerShellEnv.ts"],
    include: ["src/**/*.test.ts"]
  }
});
