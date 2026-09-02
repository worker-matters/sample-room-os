import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearNativeTabletSession,
  downloadWithNativeTablet,
  isNativeTabletRuntime,
  nativeTabletNetworkState,
  printWithNativeTablet,
  reportNativeTabletReady,
  requestNativeOrderScan,
  returnToNativeTabletLogin,
  setNextNativeUploadSource,
  setNativeTabletBusinessWriteActive,
  shareWithNativeTablet,
  switchNativeTabletNetwork
} from "./tabletNativeBridge";

describe("QC tablet native bridge", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      print: vi.fn(),
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses only the approved narrow native methods", () => {
    const bridge = {
      scanOrderQr: vi.fn(),
      clearSession: vi.fn(),
      returnToNativeLogin: vi.fn(),
      printPage: vi.fn(),
      setNextUploadSource: vi.fn(),
      downloadFile: vi.fn(),
      shareFile: vi.fn(),
      webUiReady: vi.fn(),
      networkState: vi.fn(() => JSON.stringify({ current: "LAN", lanConfigured: true, publicConfigured: true, uiVersion: "2026.08.11.102030" })),
      switchNetwork: vi.fn(),
      setBusinessWriteActive: vi.fn()
    };
    window.SampleRoomTablet = bridge;

    expect(requestNativeOrderScan()).toBe(true);
    clearNativeTabletSession();
    expect(isNativeTabletRuntime()).toBe(true);
    expect(returnToNativeTabletLogin()).toBe(true);
    expect(printWithNativeTablet()).toBe(true);
    expect(setNextNativeUploadSource("gallery")).toBe(true);
    expect(downloadWithNativeTablet("/api/qc/file", "photo.jpg", "image/jpeg")).toBe(true);
    expect(shareWithNativeTablet("/api/qc/file", "photo.jpg", "image/jpeg")).toBe(true);
    reportNativeTabletReady();
    expect(nativeTabletNetworkState()).toEqual({
      current: "LAN",
      lanConfigured: true,
      publicConfigured: true,
      uiVersion: "2026.08.11.102030",
      writeInProgress: false
    });
    expect(switchNativeTabletNetwork("PUBLIC")).toBe(true);
    setNativeTabletBusinessWriteActive(true);
    setNativeTabletBusinessWriteActive(false);
    expect(bridge.scanOrderQr).toHaveBeenCalledOnce();
    expect(bridge.clearSession).toHaveBeenCalledOnce();
    expect(bridge.returnToNativeLogin).toHaveBeenCalledOnce();
    expect(bridge.printPage).toHaveBeenCalledOnce();
    expect(bridge.setNextUploadSource).toHaveBeenCalledWith("gallery");
    expect(bridge.downloadFile).toHaveBeenCalledWith("/api/qc/file", "photo.jpg", "image/jpeg");
    expect(bridge.shareFile).toHaveBeenCalledWith("/api/qc/file", "photo.jpg", "image/jpeg");
    expect(bridge.webUiReady).toHaveBeenCalledOnce();
    expect(bridge.switchNetwork).toHaveBeenCalledWith("PUBLIC");
    expect(bridge.setBusinessWriteActive).toHaveBeenNthCalledWith(1, true);
    expect(bridge.setBusinessWriteActive).toHaveBeenNthCalledWith(2, false);
  });

  it("keeps normal browsers on the existing Web behavior", () => {
    expect(requestNativeOrderScan()).toBe(false);
    expect(printWithNativeTablet()).toBe(false);
    expect(setNextNativeUploadSource("gallery")).toBe(false);
    expect(window.print).toHaveBeenCalledOnce();
    expect(downloadWithNativeTablet("/api/qc/file", "photo.jpg", "image/jpeg")).toBe(false);
    expect(shareWithNativeTablet("/api/qc/file", "photo.jpg", "image/jpeg")).toBe(false);
    expect(nativeTabletNetworkState()).toBeUndefined();
    expect(switchNativeTabletNetwork("PUBLIC")).toBe(false);
  });
});
