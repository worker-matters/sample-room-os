import type { MiniappGlobalData } from "../../app";
import {
  completeWorkerQcScan,
  completeWorkerScan,
  resolveOrderScan,
  startWorkerScan,
  takeoverWorkerScan
} from "../../services/apiClient";
import { requireMobileApiContext } from "../../services/mobileSession";
import type { WorkerScanState } from "../../types/contracts";
import { OrderQrPayloadError, parseMiniappOrderQrPayload } from "../../utils/orderQrPayload";

const apiModeLabels = {
  undetected: "未检测",
  lan: "局域网",
  public: "公网",
  unavailable: "不可用"
} as const;

const qualityOptions = [
  { value: "qualified", label: "合格" },
  { value: "rework", label: "需返工" },
  { value: "rejected", label: "不合格" }
] as const;

const actionLabels: Record<WorkerScanState["allowedAction"], string> = {
  start: "开始当前工序",
  complete: "提交工序完成",
  takeover: "接替当前缝制任务",
  blocked: ""
};

type QcPhoto = {
  path: string;
  originalName: string;
  displayName: string;
  extension: string;
};

const maxQcPhotos = 10;

const photoName = (path: string): QcPhoto => {
  const leaf = path.replace(/\\/g, "/").split("/").pop() || "组检样衣照片.jpg";
  const dotIndex = leaf.lastIndexOf(".");
  const extension = dotIndex > 0 ? leaf.slice(dotIndex) : ".jpg";
  const displayName = dotIndex > 0 ? leaf.slice(0, dotIndex) : leaf;
  return { path, originalName: leaf, displayName, extension };
};

Page({
  data: {
    status: "尚未扫码",
    apiModeLabel: "未检测",
    loading: false,
    submitting: false,
    token: "",
    state: null as WorkerScanState | null,
    order: null as WorkerScanState["order"] | null,
    currentStageLabel: "",
    actionLabel: "",
    pieces: "",
    workHours: "",
    note: "",
    qualityOptions,
    qualityIndex: 0,
    qualityLabel: qualityOptions[0].label as string,
    qcPhotos: [] as QcPhoto[],
    qcPhotoCountLabel: `0/${maxQcPhotos}`,
    canAddQcPhoto: true,
    uploadProgress: "",
    submissionTerminated: false
  },

  onShow() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    this.setData({ apiModeLabel: apiModeLabels[app.globalData.apiMode] });
  },

  onLoad(options: Record<string, string | undefined>) {
    const payload = options.payload ? decodeURIComponent(options.payload) : "";
    if (payload) void this.resolvePayload(payload);
  },

  async scanOrderQr() {
    if (this.data.loading) return;
    const app = getApp<{ globalData: MiniappGlobalData }>();
    if (app.globalData.identityPreviewActive) {
      void wx.showToast({ title: "安全预览模式不能扫描订单", icon: "none" });
      return;
    }
    try {
      const scanned = await wx.scanCode({
        onlyFromCamera: true,
        scanType: ["qrCode"]
      });
      await this.resolvePayload(scanned.result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("cancel")) return;
      this.reportError(
        error instanceof OrderQrPayloadError ? error.message : "二维码解析失败"
      );
    }
  },

  async resolvePayload(payload: string) {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    if (app.globalData.identityPreviewActive) {
      this.reportError("安全预览模式不能扫描订单");
      return;
    }
    try {
      this.setData({
        loading: true,
        token: "",
        state: null,
        order: null,
        actionLabel: "",
        status: "正在读取订单…"
      });
      const parsed = parseMiniappOrderQrPayload(payload);
      const context = await requireMobileApiContext(app.globalData, ["worker"]);
      const response = await resolveOrderScan(
        context.baseUrl,
        payload,
        context.sessionToken
      );
      this.applyState(response.state, parsed.token, apiModeLabels[context.mode]);
      if (
        response.state.blockedReason === "wrong_stage" ||
        response.state.blockedReason === "terminated"
      ) {
        setTimeout(() => this.returnToRoleHome(), 5000);
      }
    } catch (error) {
      this.reportError(error instanceof Error ? error.message : "订单二维码读取失败");
    } finally {
      this.setData({ loading: false });
    }
  },

  applyState(state: WorkerScanState, token: string, apiModeLabel?: string) {
    this.setData({
      token,
      state,
      status: state.message ?? "订单读取成功",
      ...(apiModeLabel ? { apiModeLabel } : {}),
      order: state.order,
      currentStageLabel: state.stageLabel ?? "暂无可处理工序",
      actionLabel: actionLabels[state.allowedAction],
      pieces: state.defaultPieces === undefined ? "" : String(state.defaultPieces),
      workHours: "",
      note: "",
      qualityIndex: 0,
      qualityLabel: qualityOptions[0].label,
      qcPhotos: [],
      qcPhotoCountLabel: `0/${maxQcPhotos}`,
      canAddQcPhoto: true,
      uploadProgress: "",
      submissionTerminated: false
    });
  },

  onFieldInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field ?? "") as "pieces" | "workHours" | "note";
    if (!field) return;
    this.setData({ [field]: event.detail.value });
  },

  onQualityChange(event: WechatMiniprogram.PickerChange) {
    const qualityIndex = Number(event.detail.value);
    const option = qualityOptions[qualityIndex] ?? qualityOptions[0];
    this.setData({ qualityIndex, qualityLabel: option.label });
  },

  async chooseQcPhoto() {
    const remaining = maxQcPhotos - this.data.qcPhotos.length;
    if (remaining <= 0) {
      void wx.showToast({ title: "最多上传10张照片", icon: "none" });
      return;
    }
    try {
      const result = await wx.chooseImage({
        count: Math.min(9, remaining),
        sourceType: ["camera", "album"],
        sizeType: ["compressed", "original"]
      });
      this.updateQcPhotos([
        ...this.data.qcPhotos,
        ...result.tempFilePaths.map(photoName)
      ].slice(0, maxQcPhotos));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("cancel")) {
        void wx.showToast({ title: "样衣照片选择失败", icon: "none" });
      }
    }
  },

  updateQcPhotos(qcPhotos: QcPhoto[]) {
    this.setData({
      qcPhotos,
      qcPhotoCountLabel: `${qcPhotos.length}/${maxQcPhotos}`,
      canAddQcPhoto: qcPhotos.length < maxQcPhotos
    });
  },

  previewQcPhoto(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const photo = this.data.qcPhotos[index];
    if (!photo) return;
    void wx.previewImage({
      current: photo.path,
      urls: this.data.qcPhotos.map((item) => item.path)
    });
  },

  renameQcPhoto(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const photo = this.data.qcPhotos[index];
    if (!photo) return;
    void wx.showModal({
      title: "修改照片名称",
      editable: true,
      content: photo.displayName,
      placeholderText: `扩展名 ${photo.extension} 保持不变`
    }).then(({ confirm, content }) => {
      if (!confirm) return;
      const displayName = content.trim();
      if (
        !displayName ||
        displayName.length > 120 ||
        displayName.includes("..") ||
        /[<>:"/\\|?*\u0000-\u001f]/.test(displayName)
      ) {
        void wx.showToast({ title: "请输入安全的照片名称", icon: "none" });
        return;
      }
      this.updateQcPhotos(this.data.qcPhotos.map((item, itemIndex) =>
        itemIndex === index ? { ...item, displayName } : item
      ));
    });
  },

  removeQcPhoto(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    this.updateQcPhotos(
      this.data.qcPhotos.filter((_photo, itemIndex) => itemIndex !== index)
    );
  },

  async submitAction() {
    if (this.data.submitting || !this.data.state || !this.data.token) return;
    const state = this.data.state;
    const app = getApp<{ globalData: MiniappGlobalData }>();
    try {
      this.setData({ submitting: true });
      const context = await requireMobileApiContext(app.globalData, ["worker"]);
      let result: { state: WorkerScanState };

      if (state.allowedAction === "start") {
        result = await startWorkerScan(context.baseUrl, context.sessionToken, this.data.token);
      } else if (state.allowedAction === "takeover") {
        const reason = this.data.note.trim();
        if (!reason) throw new Error("请填写接替原因");
        const expectedActiveWorkerId = state.activeTask?.workerId;
        if (!expectedActiveWorkerId) throw new Error("当前任务负责人已变化，请重新扫码");
        result = await takeoverWorkerScan(
          context.baseUrl,
          context.sessionToken,
          this.data.token,
          reason,
          expectedActiveWorkerId
        );
      } else if (state.allowedAction === "complete") {
        const pieces = Number(this.data.pieces);
        if (!Number.isInteger(pieces) || pieces < 0) throw new Error("请填写有效的完成件数");

        if (state.stage === "qc_delivery") {
          const qualityScore = Number(this.data.workHours);
          const quality = qualityOptions[this.data.qualityIndex] ?? qualityOptions[0];
          if (!Number.isInteger(qualityScore) || qualityScore < 0 || qualityScore > 100) {
            throw new Error("请填写 0–100 的整数评分");
          }
          if (quality.value !== "qualified" && !this.data.note.trim()) {
            throw new Error("返工或不合格时必须填写备注");
          }
          const qcPhotos = this.data.qcPhotos;
          if (qcPhotos.length === 0) throw new Error("请上传样衣照片");
          result = await completeWorkerQcScan(
            context.baseUrl,
            context.sessionToken,
            this.data.token,
            qcPhotos.map((photo) => ({
              filePath: photo.path,
              displayName: photo.displayName
            })),
            {
              pieces: String(pieces),
              qualityScore: String(qualityScore),
              qualityResult: quality.value,
              note: this.data.note.trim()
            },
            (uploaded, total) => this.setData({
              uploadProgress: `正在上传 ${uploaded}/${total}`
            })
          );
        } else {
          const workHours = Number(this.data.workHours);
          if (!Number.isFinite(workHours) || workHours <= 0) throw new Error("请填写有效工时");
          if (!this.data.note.trim()) throw new Error("请填写完成备注");
          result = await completeWorkerScan(
            context.baseUrl,
            context.sessionToken,
            this.data.token,
            { pieces, workHours, note: this.data.note.trim() }
          );
        }
      } else {
        return;
      }

      this.applyState(result.state, this.data.token, apiModeLabels[context.mode]);
      void wx.showToast({ title: "操作成功", icon: "success" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "工序操作失败";
      this.setData({ status: message });
      void wx.showToast({ title: message, icon: "none" });
      if (message === "订单已终止") {
        this.setData({ submissionTerminated: true });
        setTimeout(() => this.returnToRoleHome(), 5000);
      }
    } finally {
      this.setData({ submitting: false, uploadProgress: "" });
    }
  },

  returnToRoleHome() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    wx.reLaunch({ url: app.globalData.identity?.homeRoute ?? "/pages/home/index" });
  },

  reportError(message: string) {
    this.setData({
      status: message,
      token: "",
      state: null,
      order: null,
      actionLabel: ""
    });
    void wx.showToast({ title: message, icon: "none" });
  }
});
