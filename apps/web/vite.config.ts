import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = process.env.API_PORT ?? "3001";
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? `http://127.0.0.1:${apiPort}`;
const buildAuthMode = process.env.VITE_AUTH_MODE ?? "formal";
const buildDevEntryEnabled = process.env.VITE_ENABLE_DEV_ENTRY === "true";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "sample-room-build-mode-marker",
      transformIndexHtml(html) {
        return html.replace(
          "<head>",
          `<head>
    <meta name="sample-room-auth-mode" content="${buildAuthMode}" />
    <meta name="sample-room-dev-entry-enabled" content="${String(buildDevEntryEnabled)}" />`
        );
      }
    }
  ],
  server: {
    port: 5173,
    // The public tunnel is only a temporary test path. Pre-bundle the main
    // dependencies once so repeat visits do not wait for Vite's on-demand
    // dependency discovery across a high-latency connection.
    warmup: {
      clientFiles: ["./src/main.tsx"]
    },
    proxy: {
      "/api": {
        target: apiProxyTarget,
        // Keep the browser-facing host so the API can recognize LAN/public
        // Vite requests as same-origin instead of rejecting Pad form POSTs.
        changeOrigin: false
      }
    }
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-router-dom", "antd", "@ant-design/icons", "@zxing/browser"]
  }
});
