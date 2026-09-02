import type { MiniappGlobalData } from "../../app";
import { createClientQuickPhoto, uploadClientOrderAttachment } from "../../services/apiClient";
import { isClientBusinessIdentity, requireClientApiContext } from "../../services/clientSession";

type LocalImage = { path: string; name: string; size: number };

const leafName = (path: string, fallback: string) =>
  path.replace(/\\/g, "/").split("/").pop() || fallback;

Page({
  data: {
    files: [] as LocalImage[],
    submitting: false,
    message: "",
    successMessage: ""
  },

  onShow() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    if (!isClientBusinessIdentity(app.globalData.identity)) {
      void wx.reLaunch({ url: app.globalData.identity.homeRoute });
    }
  },

  async chooseImages(sourceType: Array<"camera" | "album">) {
    const result = await wx.chooseImage({ count: 9, sourceType, sizeType: ["compressed", "original"] });
    const files = result.tempFiles.map((file, index) => ({
      path: file.path,
      name: leafName(file.path, `打样单-${index + 1}.jpg`),
      size: file.size
    }));
    this.setData({ files: [...this.data.files, ...files], message: "", successMessage: "" });
  },

  chooseCamera() { void this.chooseImages(["camera"]).catch(() => undefined); },
  chooseAlbum() { void this.chooseImages(["album"]).catch(() => undefined); },
  removeFile(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ files: this.data.files.filter((_file, current) => current !== index) });
  },

  async submit() {
    if (this.data.submitting) return;
    if (!this.data.files.length) {
      void wx.showToast({ title: "请先拍照或选择打样单图片", icon: "none" });
      return;
    }
    this.setData({ submitting: true, message: "", successMessage: "" });
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const api = await requireClientApiContext(app.globalData);
      const first = this.data.files[0]!;
      const result = await createClientQuickPhoto(api.baseUrl, api.sessionToken, first.path);
      let failedUploads = 0;
      for (const file of this.data.files.slice(1)) {
        try {
          await uploadClientOrderAttachment(api.baseUrl, api.sessionToken, result.order.id, file.path);
        } catch {
          failedUploads += 1;
        }
      }
      this.setData({
        files: [],
        successMessage: failedUploads
          ? `订单已生成，另有 ${failedUploads} 张图片上传失败`
          : "已生成待接单订单，接单员会根据图片补齐资料"
      });
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "拍照录入失败" });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
