import { niimbotWebClient, type NiimbotUsbPrinter } from "./niimbotWebClient";
import type { ReceiverLabelPrintJob } from "./receiverLabel";

type NativePrinterState = {
  status?: "disconnected" | "connecting" | "connected" | "printing";
  name?: string;
  address?: string;
};

type NativePrinterEvent = {
  state?: string;
  message?: string;
};

const NATIVE_PRINTER_EVENT = "sample-room-tablet-b1-printer";

function nativeBridge() {
  return window.SampleRoomTablet;
}

function isTabletShellRuntime() {
  return typeof navigator !== "undefined" &&
    navigator.userAgent.includes("SampleRoomTablet/");
}

function readNativePrinterState(): NativePrinterState {
  const bridge = nativeBridge();
  if (!bridge?.printerState) return { status: "disconnected" };
  try {
    return JSON.parse(bridge.printerState()) as NativePrinterState;
  } catch {
    return { status: "disconnected" };
  }
}

function waitForNativeB1Connected(): Promise<void> {
  const bridge = nativeBridge();
  const connectNative = bridge?.connectB1Printer;
  const readStateNative = bridge?.printerState;
  if (!bridge || !connectNative || !readStateNative) {
    return Promise.reject(new Error("Pad 原生打印模块不可用，请彻底退出并重新打开 Pad App"));
  }

  if (readNativePrinterState().status === "connected") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.clearInterval(poll);
      window.removeEventListener(NATIVE_PRINTER_EVENT, listener);
      if (error) reject(error);
      else resolve();
    };

    const listener = (event: Event) => {
      const detail = (event as CustomEvent<NativePrinterEvent>).detail;
      if (detail?.state === "connected") {
        finish();
      } else if (detail?.state === "error") {
        finish(new Error(detail.message || "B1 蓝牙连接失败"));
      }
    };

    const poll = window.setInterval(() => {
      if (readNativePrinterState().status === "connected") {
        finish();
      }
    }, 400);

    const timeout = window.setTimeout(() => {
      if (readNativePrinterState().status === "connected") {
        finish();
        return;
      }
      finish(new Error("B1 蓝牙连接超时，请重新搜索并选择打印机"));
    }, 60_000);

    window.addEventListener(NATIVE_PRINTER_EVENT, listener);

    try {
      connectNative.call(bridge);
    } catch (error) {
      finish(error instanceof Error ? error : new Error("B1 蓝牙连接启动失败"));
    }
  });
}

export function isNativeB1PrinterRuntime() {
  return isTabletShellRuntime() ||
    typeof nativeBridge()?.printerState === "function";
}

export function currentB1PrinterState(): NativePrinterState | { status: "connected" | "disconnected"; name?: string } {
  const bridge = nativeBridge();
  if (bridge?.printerState) {
    return readNativePrinterState();
  }
  if (isTabletShellRuntime()) {
    return { status: "disconnected" };
  }
  const selected = niimbotWebClient.selectedPrinter();
  return { status: selected ? "connected" : "disconnected", ...(selected ? { name: selected.name } : {}) };
}

export async function listB1Printers(): Promise<NiimbotUsbPrinter[]> {
  if (isNativeB1PrinterRuntime()) return [];
  return niimbotWebClient.listPrinters();
}

export async function connectB1Printer(printer?: NiimbotUsbPrinter) {
  const bridge = nativeBridge();
  if (bridge?.connectB1Printer) {
    await waitForNativeB1Connected();
    return;
  }
  if (isTabletShellRuntime()) {
    throw new Error("Pad 原生打印模块不可用，请彻底退出并重新打开 Pad App");
  }
  if (!printer) throw new Error("请选择 B1 打印机");
  await niimbotWebClient.selectPrinter(printer);
}

export async function printReceiverLabels(job: ReceiverLabelPrintJob) {
  const bridge = nativeBridge();
  if (bridge?.printB1Labels) {
    const accepted = JSON.parse(bridge.printB1Labels(JSON.stringify(job))) as { accepted?: boolean; error?: string };
    if (!accepted.accepted) throw new Error(accepted.error || "Pad 未接受打印任务");
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("打印任务超时，请检查 B1 打印机"));
      }, 120_000);
      const listener = (event: Event) => {
        const detail = (event as CustomEvent<{ state?: string; message?: string }>).detail;
        if (detail?.state === "completed") {
          cleanup();
          resolve();
        } else if (detail?.state === "error") {
          cleanup();
          reject(new Error(detail.message || "B1 打印失败"));
        }
      };
      const cleanup = () => {
        window.clearTimeout(timeout);
        window.removeEventListener(NATIVE_PRINTER_EVENT, listener);
      };
      window.addEventListener(NATIVE_PRINTER_EVENT, listener);
    });
    return;
  }
  if (isTabletShellRuntime()) {
    throw new Error("Pad 原生打印模块不可用，请彻底退出并重新打开 Pad App");
  }
  await niimbotWebClient.print(job);
}