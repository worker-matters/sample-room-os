export const environmentExample = {
  version: "0.1.0",
  expectedServiceId: "sample-room-api",
  // Production mini-program releases use only publicApiBase. LAN is development-only.
  lanApiBase: "",
  publicApiBase: "",
  healthTimeoutMs: 1000,
  buildMode: "production",
  enableDevIdentityPreview: false,
  enableDevFakeIdentityLogin: false,
  enableScanDebug: false
} as const;
