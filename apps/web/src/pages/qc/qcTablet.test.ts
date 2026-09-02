import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { qcDateRange, qcTokenFromPayload } from "../../components/qc/qcTabletUtils";
import { canUserOpenReturnPath, getFormalPostLoginPath } from "../../app/formalRouting";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pageSource = readFileSync(resolve(root, "pages/qc/QcTabletPage.tsx"), "utf8");
const photoSource = readFileSync(resolve(root, "components/qc/QcOrderPhotosModal.tsx"), "utf8");
const inspectionSource = readFileSync(resolve(root, "components/qc/QcInspectionPanel.tsx"), "utf8");
const pickerSource = readFileSync(resolve(root, "components/qc/QcEvidencePicker.tsx"), "utf8");
const nativeImagePickerSource = readFileSync(resolve(root, "components/tablet/NativeTabletImagePicker.tsx"), "utf8");
const bossOrdersSource = readFileSync(resolve(root, "components/orders/BossOrderManagementPanel.tsx"), "utf8");
const photoExportSource = readFileSync(resolve(root, "components/qc/QcPhotoExportButton.tsx"), "utf8");
const accountSecuritySource = readFileSync(resolve(root, "pages/account/AccountSecurityPage.tsx"), "utf8");

const qcWorker = {
  role: "worker" as const,
  activeWorkerType: "qc_delivery" as const
};

describe("QC tablet workbench", () => {
  it("routes only qc_delivery workers to the dedicated tablet home", () => {
    expect(getFormalPostLoginPath(qcWorker)).toBe("/qc/tablet");
    expect(canUserOpenReturnPath(qcWorker, "/qc/tablet")).toBe(true);
    expect(canUserOpenReturnPath(qcWorker, "/account/security")).toBe(true);
    expect(canUserOpenReturnPath({ role: "worker", activeWorkerType: "sewing" }, "/qc/tablet")).toBe(false);
    expect(canUserOpenReturnPath({ role: "worker", activeWorkerType: "sewing" }, "/account/security")).toBe(false);
    expect(canUserOpenReturnPath({ role: "planner" }, "/qc/tablet")).toBe(false);
    expect(getFormalPostLoginPath(qcWorker, { returnTo: "/scan/order_scan_12345678" })).toBe("/scan/order_scan_12345678");
  });

  it("reuses account security with worker phone credentials and the tablet login handoff", () => {
    expect(accountSecuritySource).toContain('profile?.accountType === "worker"');
    expect(accountSecuritySource).toContain('label="手机号"');
    expect(accountSecuritySource).toContain('name="phoneNumber"');
    expect(accountSecuritySource).toContain("returnToNativeTabletLogin");
    expect(accountSecuritySource).toContain('label="登录账号"');
    expect(accountSecuritySource).toContain('name="contact"');
  });

  it("accepts only supported order QR payload shapes", () => {
    expect(qcTokenFromPayload("SRS2|ORDER|order_scan_12345678")).toBe("order_scan_12345678");
    expect(qcTokenFromPayload("/scan/order_scan_12345678")).toBe("order_scan_12345678");
    expect(() => qcTokenFromPayload("https://example.test/orders/1")).toThrow("invalid_order_qr_payload");
    expect(() => qcTokenFromPayload("random barcode")).toThrow("invalid_order_qr_payload");
  });

  it("uses stable today, week and month ranges", () => {
    const now = new Date("2026-08-05T10:00:00+08:00");
    expect(qcDateRange("today", now)).toEqual({ dateFrom: "2026-08-05", dateTo: "2026-08-05" });
    expect(qcDateRange("week", now)).toEqual({ dateFrom: "2026-08-03", dateTo: "2026-08-05" });
    expect(qcDateRange("month", now)).toEqual({ dateFrom: "2026-08-01", dateTo: "2026-08-05" });
  });

  it("keeps the confirmed three-page information architecture and QC form semantics", () => {
    expect(pageSource).toContain('label: "扫码"');
    expect(pageSource).toContain('label: "我的组检"');
    expect(pageSource).toContain('label: "绩效"');
    expect(pageSource).not.toContain('label: "我的"');
    expect(pageSource).toContain('TabletAccountMenu roleLabel="组检/出库"');
    expect(pageSource).toContain('label: "待返工"');
    expect(pageSource).toContain('label: "已完成"');
    expect(pageSource).toContain("返工次数");
    expect(pageSource).toContain("{record.reworkCount ?? 0}次");
    expect(pageSource).toContain('const [orderDatePreset, setOrderDatePreset] = useState<QcDatePreset>("week")');
    expect(pageSource).toContain('const [performancePreset, setPerformancePreset] = useState<QcDatePreset>("week")');
    expect(pageSource).toContain('tabBarExtraContent={<div className="qc-order-date-filter">');
    expect(pageSource).toContain("<span>客户</span><span>客户业务员</span><span>款号</span>");
    expect(pageSource).not.toContain("<span>QC结果</span>");
    expect(pageSource).not.toContain("待组检订单");
    expect(inspectionSource).toContain('label: "合格并完成"');
    expect(inspectionSource).toContain('label: "需要返工"');
    expect(inspectionSource).toContain('form.setFieldValue("qualityScore", undefined)');
    expect(inspectionSource).toContain('qualityResult === "qualified" && !samplePhotos.some');
    expect(inspectionSource).toContain('"问题照片（可选）"');
    expect(inspectionSource).not.toContain("hideMeasurementPhotos");
    expect(inspectionSource).toContain('qualityResult === "qualified" ? <Form.Item label="尺寸表照片（可选）"');
    expect(inspectionSource).toContain("setSamplePhotos([])");
    expect(inspectionSource).toContain("setMeasurementPhotos([])");
    expect(pageSource).toContain("<QcAuthenticatedPhoto");
    expect(pageSource).toContain('photos={exportOrder.attachments.filter((photo) => photo.category !== "qc_issue_photo")}');
    expect(pageSource).toContain("× 关闭当前订单");
    expect(pageSource).toContain("接单员备注 / 客户特殊要求");
    expect(pageSource).toContain('width="calc(100vw - 32px)"');
    expect(pickerSource).toContain('qc_issue_photo: "问题照片"');
    expect(pickerSource).toContain('qc_sample_photo: "样衣照片"');
    expect(pickerSource).toContain('qc_measurement_photo: "尺寸表照片"');
    expect(pickerSource).toContain("multiple");
    expect(pickerSource).not.toContain("<Image");
    expect(pickerSource).toContain("URL.createObjectURL(item.file)");
    expect(inspectionSource).toContain("integerInputProps");
    expect(pickerSource).toContain("<NativeTabletImagePicker onFiles={addFiles}");
    expect(nativeImagePickerSource).toContain('capture="environment"');
    expect(nativeImagePickerSource.match(/multiple/g)).toHaveLength(2);
    expect(inspectionSource).toContain('className="qc-inspection-submit-area"');
    expect(pageSource).toContain("<SampleTypeTag value={order.sampleType}");
    expect(pageSource).toContain("<SampleRoundTag value={order.sampleRound}");
    expect(photoSource).toContain("<SampleTypeTag value={detail.sampleType}");
    expect(photoSource).toContain("<SampleRoundTag value={detail.sampleRound}");
    expect(pageSource).toContain("orderRequestIdRef");
    expect(pageSource).toContain("requestId === orderRequestIdRef.current");
    expect(pageSource).toContain("const visibleOrderIds = new Set(nextOrderList.orders.map");
    expect(pageSource).toContain("setReinspectOrder((current) => current && !visibleOrderIds.has(current.orderId) ? null : current)");
    expect(pageSource).toContain("refreshOpenScanState()");
    expect(pageSource).toContain("loadedOrderTab !== orderTab");
    expect(pageSource).toContain('page === "orders" ? ordersLoading && loadedOrderTab !== orderTab : loading');
    expect(bossOrdersSource).toContain("bossQcAction(order)");
    expect(bossOrdersSource).toContain("qcAction.label");
    expect(bossOrdersSource).toContain("getAdminQcResult");
    expect(pageSource).toContain(">组检报告导出</Button>");
    expect(pageSource).toContain("autoOpen");
    expect(bossOrdersSource).toContain("<QcPhotoExportButton");
    expect(photoExportSource).toContain(">导出 PDF</Button>");
    expect(photoExportSource).toContain(">导出合并照片</Button>");
  });

  it("keeps preview temporary and separates preview, download and share", () => {
    expect(photoSource).toContain("URL.createObjectURL(blob)");
    expect(photoSource).toContain("URL.revokeObjectURL");
    expect(photoSource).toContain("downloadBlob(preview.blob");
    expect(photoSource).toContain("navigator.canShare?.({ files: [file] })");
    expect(photoSource).toContain("当前浏览器不支持直接分享，请下载后分享");
  });

  it("stages QC photo additions and deletions until the operator confirms the update", () => {
    expect(photoSource).toContain('title: "是否确认更新"');
    expect(photoSource).toContain('okText: "确认更新"');
    expect(photoSource).toContain('cancelText: "不保存退出"');
    expect(photoSource).toContain("pendingPhotos.map((item) => item.attachment)");
    expect(photoSource).toContain("for (const attachmentId of pendingDeleteIds)");
    expect(photoSource).toContain("onCancel={requestClose}");
    expect(photoSource).toContain("stageRemove(photo)");
  });
});
