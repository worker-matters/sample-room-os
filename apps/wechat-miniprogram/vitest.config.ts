import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "./environment.local": fileURLToPath(
        new URL("./miniprogram/config/environment.local.example.ts", import.meta.url)
      )
    }
  }
});
