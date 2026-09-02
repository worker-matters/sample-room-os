export const localEnvironment = {
  // Copy to environment.local.ts. Do not commit the copied file or a real endpoint.
  // Before uploading a release, set the approved HTTPS public API origin here.
  publicApiBase: "http://127.0.0.1:5173",
  // LAN is available only when buildMode is development.
  lanApiBase: "http://127.0.0.1:5173",
  buildMode: "development",
  enableDevIdentityPreview: false,
  enableDevFakeIdentityLogin: false
} as const;
