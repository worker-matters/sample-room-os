import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = (relativePath: string) => readFileSync(path.resolve(process.cwd(), "src", relativePath), "utf8");

describe("dynamic sample type Web integration", () => {
  it("adds boss and System Owner navigation routes to the shared management panel", () => {
    const routes = src("routes/routes.tsx");
    const admin = src("pages/admin/AdminDashboardPage.tsx");
    const owner = src("pages/system-owner/SystemOwnerPage.tsx");
    expect(routes).toContain('path: "/admin/sample-types"');
    expect(routes).toContain('path: "/system-owner/sample-types"');
    expect(routes.match(/navLabel: "样衣类型管理"/g)).toHaveLength(2);
    expect(admin).toContain("<SampleTypeManagementPanel session={session} />");
    expect(owner).toContain("<SampleTypeManagementPanel session={session} />");
  });

  it("keeps the management table limited to names and move/edit actions", () => {
    const panel = src("components/sample-types/SampleTypeManagementPanel.tsx");
    expect(panel).toContain('{ title: "样衣类型名称", dataIndex: "label" }');
    expect(panel).toContain('title: "操作"');
    expect(panel).toContain('disabled={index === 0}');
    expect(panel).toContain('disabled={index === options.length - 1}');
    expect(panel).toContain('move(item.value, "up")');
    expect(panel).toContain('move(item.value, "down")');
    expect(panel).not.toContain('title: "内部 code"');
    expect(panel).not.toContain('title: "序号"');
    expect(panel).not.toContain("sortOrder");
    expect(panel).not.toContain("删除");
  });

  it("uses live options for shared filters, labels and representative order forms", () => {
    expect(src("components/orders/ClientOrderFilterBar.tsx")).toContain("useSampleTypeOptions()");
    expect(src("components/orders/OrderDesktopFilterBar.tsx")).toContain("useSampleTypeOptions()");
    expect(src("components/orders/MobileOrderFilterPanel.tsx")).toContain("useSampleTypeOptions()");
    expect(src("components/StatusTags.tsx")).toContain("labelFor(value)");
    expect(src("pages/client/ClientOrdersPage.tsx")).toContain("options={sampleTypeOptions}");
    expect(src("pages/receiver/ReceiverWorkbenchPage.tsx")).toContain("options={sampleTypeOptions}");
    expect(src("pages/planner/PlannerWorkbenchPage.tsx")).toContain("...sampleTypeOptions");
  });

  it("updates current options after create, rename and move", () => {
    const panel = src("components/sample-types/SampleTypeManagementPanel.tsx");
    expect(panel).toContain("sampleRoomApi.createSampleType");
    expect(panel).toContain("sampleRoomApi.renameSampleType");
    expect(panel).toContain("sampleRoomApi.moveSampleType");
    expect(panel).toContain("applyItems(result.items)");
  });
});
