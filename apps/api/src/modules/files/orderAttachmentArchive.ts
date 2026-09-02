import path from "node:path";

const roleRoots: Record<string, string> = {
  client_admin: "01_客户",
  client_business_user: "01_客户",
  pattern_maker: "02_版师",
  receiver: "03_接单员",
  planner: "04_计划员",
  worker: "05_组检出库"
};

const exactTargets: Record<string, string[]> = {
  receiver_material_record: ["06_面辅料记录"],
  order_charge: ["08_其他费用"],
  style_thumbnail: ["03_接单员"],
  client_reference: ["01_客户", "客户资料"],
  client_upload: ["01_客户", "客户资料"],
  client_quick_photo: ["01_客户", "快速录入"],
  receiver_sample_sheet: ["03_接单员", "打样单"],
  receiver_quick_photo: ["03_接单员", "快速录入"],
  receiver_attachment: ["03_接单员", "普通附件"],
  planner_upload: ["04_计划员", "普通附件"],
  qc_sample_photo: ["05_组检出库", "样衣照片"],
  qc_issue_photo: ["05_组检出库", "问题照片"],
  qc_measurement_photo: ["05_组检出库", "尺寸表"],
  qc_outbound_attachment: ["05_组检出库", "出库资料"]
};

const patternLabels: Record<string, string> = {
  pattern_making: "制版",
  pattern_revision: "改版",
  pattern_full_size: "推全码版",
  quote_material_check: "报价核料",
  bulk_material_check: "大货核料",
  pattern_padding_amount: "充棉/绒量",
  pattern_zipper_length: "核拉链长度",
  material_consumption: "核料",
  padding_consumption: "用量",
  other: "其他"
};

export function sanitizeArchiveLabel(value: string | undefined) {
  const safe = (value ?? "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\.\./g, "_")
    .replace(/[ .]+$/g, "")
    .trim()
    .slice(0, 80);
  return safe || "未分类";
}

export function resolveOrderAttachmentDirectory(input: {
  orderFolderRelativePath: string;
  category?: string | undefined;
  uploaderRole?: string | undefined;
  businessLabel?: string | undefined;
}) {
  if (!input.orderFolderRelativePath || path.isAbsolute(input.orderFolderRelativePath)) {
    throw new Error("A complete orderFolderRelativePath is required.");
  }
  const orderSegments = input.orderFolderRelativePath.split(/[\\/]+/).filter(Boolean);
  if (orderSegments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("orderFolderRelativePath is invalid.");
  }
  const category = input.category?.trim() ?? "";
  const exact = exactTargets[category];
  if (exact) return [...orderSegments, ...exact];
  if (input.uploaderRole === "pattern_maker") {
    return [
      ...orderSegments,
      "02_版师",
      patternLabels[category] ?? patternLabels[input.businessLabel ?? ""] ?? "未分类"
    ];
  }
  const roleRoot = input.uploaderRole ? roleRoots[input.uploaderRole] : undefined;
  if (roleRoot) return [...orderSegments, roleRoot, sanitizeArchiveLabel(input.businessLabel)];
  return [...orderSegments, "07_其他附件"];
}
