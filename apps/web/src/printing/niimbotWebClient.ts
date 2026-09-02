import type { ReceiverLabelElement, ReceiverLabelPrintJob } from "./receiverLabel";

export type NiimbotUsbPrinter = { name: string; port: number };

type ApiResponse = {
  apiName?: string;
  resultAck?: {
    errorCode?: unknown;
    info?: unknown;
    printCopies?: unknown;
    printPages?: unknown;
  };
  Error?: unknown;
};

const SERVICE_URL = "ws://127.0.0.1:37989";
const SELECTED_PRINTER_KEY = "sample-room-niimbot-b1-usb-printer";

export class NiimbotServiceUnavailableError extends Error {
  constructor() {
    super("未检测到打印服务");
    this.name = "NiimbotServiceUnavailableError";
  }
}

function errorCode(response: ApiResponse) {
  const raw = response.resultAck?.errorCode;
  const parsed = typeof raw === "string" ? Number(raw.replaceAll('"', "")) : Number(raw);
  return Number.isFinite(parsed) ? parsed : -1;
}

function ensureSuccess(response: ApiResponse, fallback: string) {
  const code = errorCode(response);
  if (code !== 0) {
    const info = typeof response.resultAck?.info === "string" ? response.resultAck.info : undefined;
    throw new Error(info || fallback);
  }
  return response;
}

class NiimbotTransport {
  private socket: WebSocket | undefined;
  private pending = new Map<string, { resolve: (value: ApiResponse) => void; timer: number }>();
  private listeners = new Set<(message: ApiResponse) => void>();

  async open() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (typeof WebSocket === "undefined") throw new Error("当前浏览器不支持打印服务连接");
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(SERVICE_URL);
      const timer = window.setTimeout(() => {
        socket.close();
        reject(new NiimbotServiceUnavailableError());
      }, 4_000);
      socket.onopen = () => {
        window.clearTimeout(timer);
        this.socket = socket;
        resolve();
      };
      socket.onerror = () => {
        window.clearTimeout(timer);
        reject(new NiimbotServiceUnavailableError());
      };
      socket.onclose = () => {
        if (this.socket === socket) this.socket = undefined;
        this.pending.forEach(({ resolve, timer: pendingTimer }, apiName) => {
          window.clearTimeout(pendingTimer);
          resolve({ apiName, resultAck: { errorCode: 23, info: "打印服务连接已断开" } });
        });
        this.pending.clear();
      };
      socket.onmessage = (event) => {
        let message: ApiResponse;
        try {
          message = JSON.parse(String(event.data)) as ApiResponse;
        } catch {
          return;
        }
        if (message.apiName === "commitJob") {
          this.listeners.forEach((listener) => listener(message));
          return;
        }
        const apiName = message.apiName;
        if (!apiName) return;
        const request = this.pending.get(apiName);
        if (!request) return;
        window.clearTimeout(request.timer);
        this.pending.delete(apiName);
        request.resolve(message);
      };
    });
  }

  async request(apiName: string, parameter?: unknown, timeoutMs = 10_000) {
    await this.open();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("精臣打印服务未连接");
    }
    if (this.pending.has(apiName)) throw new Error(`打印服务请求仍在进行：${apiName}`);
    return new Promise<ApiResponse>((resolve) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(apiName);
        resolve({ apiName, resultAck: { errorCode: 22, info: "打印服务响应超时" } });
      }, timeoutMs);
      this.pending.set(apiName, { resolve, timer });
      this.socket!.send(JSON.stringify(parameter === undefined ? { apiName } : { apiName, parameter }));
    });
  }

  send(apiName: string, parameter?: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("精臣打印服务未连接");
    this.socket.send(JSON.stringify(parameter === undefined ? { apiName } : { apiName, parameter }));
  }

  subscribe(listener: (message: ApiResponse) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export class NiimbotWebClient {
  private readonly transport = new NiimbotTransport();
  private selected?: NiimbotUsbPrinter;
  private printing = false;

  constructor() {
    if (typeof localStorage === "undefined") return;
    try {
      const parsed = JSON.parse(localStorage.getItem(SELECTED_PRINTER_KEY) || "null") as Partial<NiimbotUsbPrinter> | null;
      if (parsed && typeof parsed.name === "string" && Number.isInteger(parsed.port)) {
        this.selected = { name: parsed.name, port: parsed.port! };
      }
    } catch {
      localStorage.removeItem(SELECTED_PRINTER_KEY);
    }
  }

  selectedPrinter() {
    return this.selected;
  }

  async listPrinters(): Promise<NiimbotUsbPrinter[]> {
    await this.transport.open();
    ensureSuccess(await this.transport.request("initSdk", { fontDir: "" }), "打印 SDK 初始化失败");
    const response = ensureSuccess(await this.transport.request("getAllPrinters"), "没有检测到在线的精臣 USB 打印机");
    const info = response.resultAck?.info;
    const printers = typeof info === "string" ? JSON.parse(info) as Record<string, unknown> : {};
    return Object.entries(printers)
      .map(([name, port]) => ({ name, port: Number(port) }))
      .filter((printer) => printer.name.length > 0 && Number.isInteger(printer.port));
  }

  async selectPrinter(printer: NiimbotUsbPrinter) {
    await this.transport.open();
    ensureSuccess(await this.transport.request("initSdk", { fontDir: "" }), "打印 SDK 初始化失败");
    ensureSuccess(
      await this.transport.request("selectPrinter", { printerName: printer.name, port: printer.port }, 15_000),
      "B1 打印机连接失败"
    );
    this.selected = printer;
    localStorage.setItem(SELECTED_PRINTER_KEY, JSON.stringify(printer));
  }

  private async renderElement(element: ReceiverLabelElement) {
    if (element.type === "qr") {
      ensureSuccess(await this.transport.request("DrawLableQrCode", {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        value: element.value,
        codeType: 31,
        rotate: 0
      }), "二维码绘制失败");
      return;
    }
    ensureSuccess(await this.transport.request("DrawLableText", {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      value: element.value,
      fontFamily: "",
      fontSize: element.fontSize,
      rotate: 0,
      textAlignHorizonral: 0,
      textAlignVertical: 1,
      letterSpacing: 0,
      lineSpacing: 1,
      lineMode: 6,
      fontStyle: [element.bold === true, false, false, false]
    }), "文字绘制失败");
  }

  async print(job: ReceiverLabelPrintJob) {
    if (this.printing) throw new Error("已有打印任务正在进行");
    if (!this.selected) throw new Error("请先在打印设置中连接精臣 B1 打印机");
    if (job.pages.length === 0) throw new Error("没有可打印的标签");
    this.printing = true;
    try {
      await this.selectPrinter(this.selected);
      let pageIndex = 0;
      let rendering = false;
      await new Promise<void>(async (resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("打印任务超时，请检查打印机状态")), 120_000);
        let unsubscribe = () => {};
        const finish = (action: () => void) => {
          window.clearTimeout(timeout);
          unsubscribe();
          action();
        };
        unsubscribe = this.transport.subscribe((message) => {
          const ack = message.resultAck;
          if (errorCode(message) !== 0) {
            finish(() => reject(new Error(typeof ack?.info === "string" ? ack.info : "打印机报告异常")));
            return;
          }
          if (Number(ack?.printPages) === job.pages.length && Number(ack?.printCopies) === job.copies) {
            void this.transport.request("endJob").then((response) => {
              ensureSuccess(response, "结束打印任务失败");
              finish(resolve);
            }).catch((error) => finish(() => reject(error)));
            return;
          }
          if (ack?.info !== "commitJob ok!" || rendering || pageIndex >= job.pages.length) return;
          rendering = true;
          const page = job.pages[pageIndex++]!;
          void (async () => {
            ensureSuccess(await this.transport.request("InitDrawingBoard", {
              width: page.widthMm,
              height: page.heightMm,
              rotate: 0,
              path: "",
              verticalShift: 0,
              HorizontalShift: 0
            }), "标签画板初始化失败");
            for (const element of page.elements) await this.renderElement(element);
            this.transport.send("commitJob", {
              printData: null,
              printerImageProcessingInfo: { printQuantity: job.copies }
            });
          })().catch((error) => finish(() => reject(error))).finally(() => { rendering = false; });
        });
        try {
          ensureSuccess(await this.transport.request("startJob", {
            printDensity: job.density,
            printLabelType: job.labelType,
            printMode: job.printMode,
            count: job.pages.length * job.copies
          }), "无法开始打印任务");
        } catch (error) {
          finish(() => reject(error));
        }
      });
    } finally {
      this.printing = false;
    }
  }
}

export const niimbotWebClient = new NiimbotWebClient();
