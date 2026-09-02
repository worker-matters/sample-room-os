import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createPadUiManifest, validateWebBuildEnvironment } from "./build-web.mjs";

test("formal builds require an explicitly disabled developer entry", () => {
  assert.deepEqual(
    validateWebBuildEnvironment({
      VITE_AUTH_MODE: "formal",
      VITE_ENABLE_DEV_ENTRY: "false"
    }),
    { authMode: "formal", devEntryEnabled: false }
  );
  assert.throws(
    () => validateWebBuildEnvironment({ VITE_AUTH_MODE: "formal" }),
    /VITE_ENABLE_DEV_ENTRY/
  );
  assert.throws(
    () =>
      validateWebBuildEnvironment({
        VITE_AUTH_MODE: "formal",
        VITE_ENABLE_DEV_ENTRY: "true"
      }),
    /require VITE_ENABLE_DEV_ENTRY/
  );
});

test("configured builds reject a missing or unknown auth mode", () => {
  assert.throws(
    () => validateWebBuildEnvironment({ VITE_ENABLE_DEV_ENTRY: "false" }),
    /VITE_AUTH_MODE/
  );
  assert.throws(
    () =>
      validateWebBuildEnvironment({
        VITE_AUTH_MODE: "production",
        VITE_ENABLE_DEV_ENTRY: "false"
      }),
    /VITE_AUTH_MODE/
  );
});

test("explicit development builds remain available", () => {
  assert.deepEqual(
    validateWebBuildEnvironment({
      VITE_AUTH_MODE: "dev",
      VITE_ENABLE_DEV_ENTRY: "true"
    }),
    { authMode: "dev", devEntryEnabled: true }
  );
});

test("Pad UI manifests use an automatic release version and hash every build file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sample-room-pad-ui-"));
  try {
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "index.html"), "<html>Pad</html>");
    await writeFile(path.join(root, "assets", "app-123.js"), "console.log('pad');");
    const manifest = await createPadUiManifest(root, new Date("2026-08-11T10:20:30.000Z"));
    assert.equal(manifest.uiVersion, "2026.08.11.102030");
    assert.equal(manifest.files.length, 2);
    assert.deepEqual(manifest.files.map((file) => file.path), ["assets/app-123.js", "index.html"]);
    assert.match(manifest.bundleSha256, /^[a-f0-9]{64}$/);
    assert.ok(manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
