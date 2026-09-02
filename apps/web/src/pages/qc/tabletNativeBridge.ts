export type SampleRoomTabletBridge = {
  scanOrderQr: () => void;
  clearSession: () => void;
  returnToNativeLogin: () => void;
  printPage: () => void;
  setNextUploadSource: (source: "gallery") => void;
  downloadFile: (relativePath: string, displayName: string, mimeType: string) => void;
  shareFile: (relativePath: string, displayName: string, mimeType: string) => void;
  webUiReady?: () => void;
  networkState?: () => string;
  switchNetwork?: (addressType: "LAN" | "PUBLIC") => void;
  setBusinessWriteActive?: (active: boolean) => void;
  printerState?: () => string;
  connectB1Printer?: () => void;
  printB1Labels?: (jobJson: string) => string;
  saveGeneratedFile?: (base64: string, displayName: string, mimeType: string) => void;
};

declare global {
  interface Window {
    SampleRoomTablet?: SampleRoomTabletBridge;
  }
}

export function requestNativeOrderScan() {
  if (!window.SampleRoomTablet?.scanOrderQr) return false;
  window.SampleRoomTablet.scanOrderQr();
  return true;
}

export function clearNativeTabletSession() {
  window.SampleRoomTablet?.clearSession?.();
}

export function isNativeTabletRuntime() {
  return Boolean(window.SampleRoomTablet?.returnToNativeLogin);
}

export type NativeTabletNetworkState = {
  current?: "LAN" | "PUBLIC";
  lanConfigured: boolean;
  publicConfigured: boolean;
  uiVersion: string;
  writeInProgress: boolean;
};

export function reportNativeTabletReady() {
  window.SampleRoomTablet?.webUiReady?.();
}

export function nativeTabletNetworkState(): NativeTabletNetworkState | undefined {
  const raw = window.SampleRoomTablet?.networkState?.();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<NativeTabletNetworkState>;
    return {
      ...(parsed.current === "LAN" || parsed.current === "PUBLIC" ? { current: parsed.current } : {}),
      lanConfigured: parsed.lanConfigured === true,
      publicConfigured: parsed.publicConfigured === true,
      uiVersion: typeof parsed.uiVersion === "string" ? parsed.uiVersion : "",
      writeInProgress: parsed.writeInProgress === true
    };
  } catch {
    return undefined;
  }
}

export function switchNativeTabletNetwork(addressType: "LAN" | "PUBLIC") {
  if (!window.SampleRoomTablet?.switchNetwork) return false;
  window.SampleRoomTablet.switchNetwork(addressType);
  return true;
}

export function setNativeTabletBusinessWriteActive(active: boolean) {
  if (typeof window === "undefined") return;
  window.SampleRoomTablet?.setBusinessWriteActive?.(active);
  if (typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent("sample-room-tablet-write-state", { detail: { active } }));
  }
}

export function subscribeToNativeTabletWriteState(onChange: (active: boolean) => void) {
  const listener = (event: Event) => {
    const active = (event as CustomEvent<{ active?: unknown }>).detail?.active;
    if (typeof active === "boolean") onChange(active);
  };
  window.addEventListener("sample-room-tablet-write-state", listener);
  return () => window.removeEventListener("sample-room-tablet-write-state", listener);
}

export function setNextNativeUploadSource(source: "gallery") {
  if (!window.SampleRoomTablet?.setNextUploadSource) return false;
  window.SampleRoomTablet.setNextUploadSource(source);
  return true;
}

export function returnToNativeTabletLogin() {
  if (window.SampleRoomTablet?.returnToNativeLogin) {
    window.SampleRoomTablet.returnToNativeLogin();
    return true;
  }
  return false;
}

export function printWithNativeTablet() {
  if (!window.SampleRoomTablet?.printPage) {
    window.print();
    return false;
  }
  window.SampleRoomTablet.printPage();
  return true;
}

export function downloadWithNativeTablet(
  relativePath: string,
  displayName: string,
  mimeType: string
) {
  if (!window.SampleRoomTablet?.downloadFile) return false;
  window.SampleRoomTablet.downloadFile(relativePath, displayName, mimeType);
  return true;
}

export function shareWithNativeTablet(
  relativePath: string,
  displayName: string,
  mimeType: string
) {
  if (!window.SampleRoomTablet?.shareFile) return false;
  window.SampleRoomTablet.shareFile(relativePath, displayName, mimeType);
  return true;
}

export async function saveGeneratedWithNativeTablet(blob: Blob, displayName: string, mimeType: string) {
  if (!window.SampleRoomTablet?.saveGeneratedFile) return false;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  window.SampleRoomTablet.saveGeneratedFile(btoa(binary), displayName, mimeType);
  return true;
}

export function subscribeToNativeOrderScans(onPayload: (payload: string) => void) {
  const listener = (event: Event) => {
    const payload = (event as CustomEvent<{ payload?: unknown }>).detail?.payload;
    if (typeof payload === "string" && payload.length <= 2048) onPayload(payload);
  };
  window.addEventListener("sample-room-tablet-order-qr", listener);
  return () => window.removeEventListener("sample-room-tablet-order-qr", listener);
}
