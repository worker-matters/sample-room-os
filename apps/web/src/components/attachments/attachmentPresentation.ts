export const attachmentSourceRoleOptions = [
  { label: "全部来源", value: "all" },
  { label: "接单员", value: "receiver" },
  { label: "计划员", value: "planner" },
  { label: "版师", value: "pattern_maker" },
  { label: "老板", value: "boss" },
  { label: "System Owner", value: "system_owner" }
] as const;

export const attachmentRoleLabels: Record<string, string> = {
  receiver: "接单员",
  planner: "计划员",
  pattern_maker: "版师",
  boss: "老板",
  system_owner: "System Owner",
  client_admin: "客户主管",
  client_business_user: "客户业务员"
};

export const attachmentTagLabels: Record<string, string> = {
  sample_sheet: "打样单相关",
  style_thumbnail: "打样单相关",
  receiver_sample_sheet: "打样单相关",
  receiver_attachment: "普通附件",
  receiver_quick_photo: "打样单相关",
  sample_room_upload: "生产资料",
  planner_upload: "生产资料",
  receiver_upload: "打样单相关",
  receiver_material_record: "面辅料记录",
  client_reference: "客户资料",
  client_result: "其他附件",
  pattern_file: "制版",
  cutting_pattern_file: "制版",
  pattern_making: "制版",
  pattern_revision: "改版",
  pattern_full_size: "推全码版",
  full_size_pattern: "推全码版",
  quote_material_check: "报价核料",
  bulk_material_check: "大货核料",
  pattern_padding_amount: "用衬核算",
  padding_consumption: "用衬核算",
  pattern_zipper_length: "拉链长度核算",
  zipper_length: "拉链长度核算",
  material_consumption: "核料",
  layout_diagram: "排料图",
  print_position: "印花位置",
  embroidery_position: "绣花位置",
  process_note: "工艺说明",
  revision_note: "改版说明",
  render_3d: "3D效果图",
  rotation_video_3d: "3D旋转视频",
  order_charge: "其他费用凭证",
  photo: "照片",
  image: "照片",
  other: "其他附件"
};

export function attachmentTagLabel(value?: string) {
  if (!value) return "其他附件";
  return attachmentTagLabels[value] ?? "其他附件";
}

export function attachmentUploaderLabel(attachment: {
  uploadedByName?: string | undefined;
  uploadedBy?: string | undefined;
}) {
  return attachment.uploadedByName?.trim() || "-";
}
