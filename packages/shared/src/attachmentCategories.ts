export const ATTACHMENT_VISIBILITY = {
  clientUploadAllowed: "client_upload_allowed",
  clientVisible: "client_visible",
  internalOnly: "internal_only"
} as const;

export type AttachmentVisibility =
  (typeof ATTACHMENT_VISIBILITY)[keyof typeof ATTACHMENT_VISIBILITY];

export type AttachmentCategory = {
  key: string;
  label: string;
  visibility: AttachmentVisibility;
  description: string;
};

export const ATTACHMENT_CATEGORIES: AttachmentCategory[] = [
  {
    key: "client_reference",
    label: "客户参考资料",
    visibility: ATTACHMENT_VISIBILITY.clientVisible,
    description: "客户可上传并可见的款式图、尺寸表、说明文件。"
  },
  {
    key: "client_result",
    label: "客户可见结果",
    visibility: ATTACHMENT_VISIBILITY.clientVisible,
    description: "内部上传但允许客户查看的交付确认材料。"
  },
  {
    key: "internal_pattern",
    label: "内部制版资料",
    visibility: ATTACHMENT_VISIBILITY.internalOnly,
    description: "版房、裁剪、缝制、组检等内部工序资料。"
  },
  {
    key: "internal_pricing",
    label: "内部报价/成本资料",
    visibility: ATTACHMENT_VISIBILITY.internalOnly,
    description: "报价、成本、对账相关附件，客户不可见。"
  }
];
