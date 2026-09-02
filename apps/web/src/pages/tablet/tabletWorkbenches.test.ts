import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pageDir = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(resolve(pageDir, path), "utf8");

describe("Hybrid Pad workbenches", () => {
  const routes = read("../../routes/routes.tsx");
  const app = read("../../app/App.tsx");
  const receiver = read("../receiver/ReceiverWorkbenchPage.tsx");
  const planner = read("../planner/PlannerWorkbenchPage.tsx");
  const header = read("../../components/tablet/TabletWorkbenchHeader.tsx");
  const accountMenu = read("../../components/tablet/TabletAccountMenu.tsx");
  const networkControl = read("../../components/tablet/TabletNetworkControl.tsx");
  const receiverAttachments = read("../../components/receiver/ReceiverIntakeAttachmentWorkspace.tsx");
  const password = read("../account/ForcePasswordChangePage.tsx");
  const styles = read("../../app/styles.css");

  it("registers the three frameless workbenches and keeps boss on the formal admin route", () => {
    expect(routes).toContain('path: "/qc/tablet"');
    expect(routes).toContain('path: "/receiver/tablet"');
    expect(routes).toContain('path: "/planner/tablet"');
    expect(routes).not.toContain('path: "/tablet/login"');
    expect(app).toContain('"/receiver/tablet"');
    expect(app).toContain('"/planner/tablet"');
    expect(app).toContain("tabletWorkbenchPaths.has(location.pathname)");
    expect(app).toContain('session.role === "boss" && isNativeTabletRuntime()');
    expect(app).toContain('" boss-tablet-shell"');
  });

  it("shares the receiver workbench and exposes list actions on tablet", () => {
    expect(routes).toContain('<ReceiverWorkbenchPage initialTab="self-entry" tablet />');
    expect(receiver).toContain("tablet?: boolean");
    expect(receiver).toContain('<Button size="small" onClick={() => void openChargeDialog(order)}>其他费用 {order.chargeCount ?? 0}</Button>');
    expect(receiver).toContain('<Button size="small" onClick={() => openMaterialRecord(order)}>面辅料记录 {order.materialRecordCount ?? 0}</Button>');
    for (const label of ["订单录入", "待接单", "订单列表"]) expect(receiver).toContain(label);
    expect(receiver).toContain("getMobileScanChargeContext(session, \"receiver\", token)");
    expect(receiver).toContain("parseOrderQrPayload(payload)");
    expect(receiver).toContain("setChargeOrder(tabletScannedOrder)");
    expect(receiver).toContain("openMaterialRecord(tabletScannedOrder)");
    expect(receiver).toContain("其他费用 {tabletScannedOrder.chargeCount ?? 0}");
    expect(receiver).toContain("面辅料记录 {tabletScannedOrder.materialRecordCount ?? 0}");
    expect(receiver).toContain("已登记的面辅料记录");
    expect(receiver).not.toContain("<MobileScanChargePanel");
  });

  it("shares the formal planner workbench and keeps phone-only scan UI out of tablet", () => {
    expect(routes).toContain("<PlannerWorkbenchPage tablet />");
    expect(planner).toContain("tablet?: boolean");
    expect(planner).not.toContain("面辅料记录");
    expect(planner).toContain("getMobileScanChargeContext(session, \"planner\", token)");
    expect(planner).toContain("setChargeOrder(order)");
    expect(planner).toContain("查看详情");
    expect(routes).not.toContain("<PlannerWorkbenchPage tablet mobile");
  });

  it("keeps scan resolution read-only and reuses existing business modals", () => {
    expect(receiver).toContain("ReceiverOrderChargeModal");
    expect(planner).toContain("ReceiverOrderChargeModal");
    expect(receiver).not.toContain("addReceiverOrderChargeByScanToken");
    expect(planner).not.toContain("addPlannerOrderChargeByScanToken");
    expect(receiver).toContain('category: "receiver_material_record"');
  });

  it("provides touch headers, native logout handoff, and responsive 10-to-13-inch layout", () => {
    expect(header).toContain("TabletAccountMenu");
    expect(header).toContain("TabletNetworkControl");
    expect(app).toContain("reportNativeTabletReady");
    expect(app).toContain("bossTablet ? <TabletNetworkControl /> : null");
    expect(networkControl).toContain('switchLine("LAN")');
    expect(networkControl).toContain('switchLine("PUBLIC")');
    expect(networkControl).toContain("请先保存或关闭当前输入弹窗");
    expect(networkControl).toContain("UI v");
    expect(accountMenu).toContain("returnToNativeTabletLogin");
    expect(read("../qc/tabletNativeBridge.ts")).toContain("printWithNativeTablet");
    expect(accountMenu).toContain("账号与安全");
    expect(accountMenu).toContain("退出登录");
    expect(header).toContain("扫码");
    expect(password).toContain("returnToNativeTabletLogin");
    expect(styles).toContain(".tablet-workbench-header");
    expect(styles).toContain("@media (max-width: 1100px)");
    expect(styles).toContain("@media (min-width: 1400px)");
    expect(receiverAttachments).toContain('tablet ? "拍照" : "拍摄下一张"');
    expect(receiverAttachments).toContain('setNextNativeUploadSource("gallery")');
  });
});
