import { buildWeb } from "./build-web.mjs";

await buildWeb({
  ...process.env,
  VITE_AUTH_MODE: "formal",
  VITE_ENABLE_DEV_ENTRY: "false"
});
