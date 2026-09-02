import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  attachmentOperationErrorMessage,
  attachmentUploadErrorMessage
} from "./attachmentErrors";

const webSrc = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = (relativePath: string) =>
  readFileSync(resolve(webSrc, relativePath), "utf8").replaceAll("\r\n", "\n");

describe("attachment visibility UI", () => {
  it("translates upload and operation error codes without exposing English keys", () => {
    expect(attachmentUploadErrorMessage(new Error("attachment_upload_limit_exceeded")))
      .toBe("单个附件不能超过30MB");
    expect(attachmentUploadErrorMessage(new Error("LIMIT_FILE_COUNT")))
      .toBe("一次最多上传30个附件");
    expect(attachmentUploadErrorMessage(new Error("upload_request_too_large")))
      .toBe("单次上传附件总大小不能超过300MB");
    expect(attachmentUploadErrorMessage(new Error("unknown_internal_key")))
      .toBe("附件上传失败，请重试");
    expect(attachmentOperationErrorMessage(new Error("pattern_deliverable_minimum_required")))
      .toBe("该任务至少需要保留1个有效交付物");
  });

  it("keeps per-file visibility choice in the shared picker", () => {
    const picker = source("components/ClientAttachmentPicker.tsx");
    expect(picker).toContain("showVisibilityChoice");
    expect(picker).toContain("客户可见");
    expect(picker).toContain('visibility: clientVisible ? "client_visible" : "internal_only"');
  });

  it("shows the normalized visibility column and action before preview", () => {
    const table = source("components/attachments/UnifiedAttachmentTable.tsx");
    expect(table.indexOf('title: "上传时间"')).toBeLessThan(table.indexOf('title: "客户可见"'));
    expect(table.indexOf('title: "客户可见"')).toBeLessThan(table.indexOf('title: "操作"'));
    expect(table.indexOf("设为可见")).toBeLessThan(table.indexOf("预览/打开"));
    expect(table).toContain('<Tag color="green">是</Tag>');
    expect(table).toContain("<Tag>否</Tag>");
    expect(table).not.toContain("client_upload_allowed");
  });

  it("keeps the fixed action column complete and long names from hiding rename", () => {
    const table = source("components/attachments/UnifiedAttachmentTable.tsx");
    const styles = source("app/styles.css");
    expect(table).toContain('fixed: "right"');
    expect(table).toContain("width: 360");
    expect(table).toContain('className="unified-attachment-actions"');
    expect(table).toContain('className="unified-attachment-file-name"');
    expect(table).toContain('className="unified-attachment-rename-button"');
    expect(styles).toContain(".unified-attachment-file-name");
    expect(styles).toContain("min-width: 0;");
    expect(styles).toContain("text-overflow: ellipsis;");
    expect(styles).toContain("flex: 0 0 auto;");
    expect(styles).toContain("white-space: nowrap;");
  });

  it("uses one table across manager, receiver, planner and pattern-maker details", () => {
    for (const file of [
      "components/orders/BossOrderManagementPanel.tsx",
      "pages/receiver/ReceiverWorkbenchPage.tsx",
      "pages/planner/PlannerWorkbenchPage.tsx",
      "pages/pattern-maker/PatternTaskWorkbenchPage.tsx"
    ]) {
      expect(source(file)).toContain("<UnifiedAttachmentTable");
    }
  });

  it("applies role defaults and the manager upload entry without exposing orderNo in the detail hero", () => {
    const receiver = source("pages/receiver/ReceiverWorkbenchPage.tsx");
    const planner = source("pages/planner/PlannerWorkbenchPage.tsx");
    const pattern = source("pages/pattern-maker/PatternTaskWorkbenchPage.tsx");
    const manager = source("components/orders/BossOrderManagementPanel.tsx");
    expect(receiver).toContain('defaultCategory="receiver_attachment"');
    expect(receiver).toContain('defaultVisibility="internal_only"');
    expect(planner).toContain('defaultVisibility="internal_only"');
    expect(pattern).toContain('defaultVisibility="client_visible"');
    expect(manager).toContain("addAdminOrderAttachments");
    expect(manager).toContain('defaultCategory="other"');
    expect(manager).toContain("onRow={(order)");
    expect(manager).toContain("款号 / 款名");
    expect(manager).not.toContain("<Typography.Title level={5}>{detailOrder.orderNo}</Typography.Title>");
  });

  it("uses one centered manager detail modal without the duplicate heading", () => {
    const manager = source("components/orders/BossOrderManagementPanel.tsx");
    expect(manager).not.toContain("Drawer");
    expect(manager).not.toContain("订单 / 款式");
    expect(manager).toContain("款号 / 款名");
    expect(manager).toContain("centered");
    expect(manager).toContain('width="min(1080px, calc(100vw - 32px))"');
    expect(manager).toContain("open={detailOpen}");
    expect(manager).toContain("onCancel={() => setDetailOpen(false)}");
    expect(manager).toContain("刷新详情");
    expect(manager).toContain('<Button onClick={() => setDetailOpen(false)}>关闭</Button>');
  });

  it("loads pattern attachment logs and opens current-task materials by default", () => {
    const pattern = source("pages/pattern-maker/PatternTaskWorkbenchPage.tsx");
    expect(pattern).not.toContain("logs={[]}");
    expect(pattern).toContain("logs={logs}");
    expect(pattern).toContain("attachmentLogsByOrder");
    expect(pattern).toContain("result.logs");
    expect(pattern).toContain("refreshTaskMaterials");
    expect(pattern).toContain('defaultActiveKey={["materials"]}');
  });
});
