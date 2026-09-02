const attachmentErrorMessages: Record<string, string> = {
  attachment_upload_limit_exceeded: "单个附件不能超过30MB",
  LIMIT_FILE_SIZE: "单个附件不能超过30MB",
  LIMIT_FILE_COUNT: "一次最多上传30个附件",
  LIMIT_UNEXPECTED_FILE: "一次最多上传30个附件",
  upload_request_too_large: "单次上传附件总大小不能超过300MB",
  upload_rate_limit_exceeded: "当前上传任务较多，请稍后重试",
  upload_concurrency_limit_exceeded: "当前上传任务较多，请稍后重试",
  attachment_operation_forbidden: "无权操作此附件",
  pattern_deliverable_minimum_required: "该任务至少需要保留1个有效交付物"
};

function errorCode(error: unknown) {
  if (error instanceof Error) return error.message.trim();
  if (typeof error === "string") return error.trim();
  return "";
}

export function attachmentUploadErrorMessage(error: unknown) {
  return attachmentErrorMessages[errorCode(error)] ?? "附件上传失败，请重试";
}

export function attachmentOperationErrorMessage(error: unknown) {
  return attachmentErrorMessages[errorCode(error)] ?? "操作失败，请重试";
}
