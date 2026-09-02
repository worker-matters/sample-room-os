import type { DevSession } from "../app/DevSessionContext";
import { setNativeTabletBusinessWriteActive } from "../pages/qc/tabletNativeBridge";

type AttachmentMetadataLike = {
  fileName: string;
  category?: string;
  visibility?: string | undefined;
  file?: File;
};

type OrderPayloadWithAttachments = Record<string, unknown> & {
  attachments?: AttachmentMetadataLike[];
};

type ReceiverQuickPhotoPayloadLike = {
  customerId: string;
  clientUserId: string;
  quantity: number;
  sampleRequestItems: string[];
  remark?: string;
  attachments: AttachmentMetadataLike[];
  thumbnailAttachmentIndex?: number | undefined;
};

let activeBusinessWriteRequests = 0;

function isBusinessWrite(init: RequestInit) {
  const method = (init.method ?? "GET").toUpperCase();
  return method !== "GET" && method !== "HEAD";
}

async function withBusinessWriteActivity<T>(init: RequestInit, action: () => Promise<T>) {
  if (!isBusinessWrite(init)) return action();
  activeBusinessWriteRequests += 1;
  if (activeBusinessWriteRequests === 1) setNativeTabletBusinessWriteActive(true);
  try {
    return await action();
  } finally {
    activeBusinessWriteRequests = Math.max(0, activeBusinessWriteRequests - 1);
    if (activeBusinessWriteRequests === 0) setNativeTabletBusinessWriteActive(false);
  }
}

function sessionHeaders(session: DevSession, options: { json?: boolean } = { json: true }) {
  const headers: Record<string, string> = {};

  if (options.json !== false) {
    headers["content-type"] = "application/json";
  }

  if (session.authMode === "formal") {
    return headers;
  }

  headers["x-dev-role"] = session.role;
  headers["x-dev-user-id"] = session.userId;
  if (session.accountType) headers["x-dev-account-type"] = session.accountType;
  if (session.activeWorkerProfileId) headers["x-dev-active-worker-profile-id"] = session.activeWorkerProfileId;
  if (session.activeWorkerType) headers["x-dev-active-worker-type"] = session.activeWorkerType;

  if (session.customerId) {
    headers["x-dev-customer-id"] = session.customerId;
  }

  if (session.clientUserId) {
    headers["x-dev-client-user-id"] = session.clientUserId;
  }

  if (session.clientAccessScope) {
    headers["x-dev-client-access-scope"] = session.clientAccessScope;
  }

  return headers;
}

function jsonBodyFromResponseText(responseText: string) {
  if (responseText.trim().length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    return { error: responseText };
  }
}

function throwIfNotOk(response: Response, body: unknown) {
  if (response.ok) {
    return;
  }

  const errorMessage =
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
      ? body.error
      : `HTTP ${response.status}`;
  throw new Error(errorMessage);
}

export async function request<T>(session: DevSession, path: string, init: RequestInit = {}) {
  return withBusinessWriteActivity(init, async () => {
    const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
    const response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: {
        ...sessionHeaders(session, { json: !isFormData }),
        ...(init.headers ?? {})
      }
    });
    const body = jsonBodyFromResponseText(await response.text());

    throwIfNotOk(response, body);

    if (body === undefined) {
      throw new Error(`API did not return JSON for ${path}. Please confirm the API dev server is running.`);
    }

    return body as T;
  });
}
function hasRealAttachmentFiles(attachments: AttachmentMetadataLike[] | undefined) {
  return (
    attachments?.some(
      (attachment) => typeof File !== "undefined" && attachment.file instanceof File
    ) ?? false
  );
}

function appendAttachmentFiles(
  formData: FormData,
  attachments: AttachmentMetadataLike[] = [],
  bundledMetadata = false
) {
  const uploadedMetadata: Array<{ category: string; visibility?: string }> = [];
  for (const attachment of attachments) {
    if (typeof File === "undefined" || !(attachment.file instanceof File)) {
      continue;
    }

    formData.append("files", attachment.file, attachment.fileName);
    if (bundledMetadata) {
      uploadedMetadata.push({
        category: attachment.category ?? "client_reference",
        ...(attachment.visibility ? { visibility: attachment.visibility } : {})
      });
    } else {
      formData.append("category", attachment.category ?? "client_reference");
      if (attachment.visibility) {
        formData.append("visibility", attachment.visibility);
      }
    }
  }
  if (bundledMetadata && uploadedMetadata.length > 0) {
    formData.append("attachmentMetadata", JSON.stringify(uploadedMetadata));
  }
}

export function bodyForOrderPayload(payload: OrderPayloadWithAttachments): BodyInit {
  if (!hasRealAttachmentFiles(payload.attachments)) {
    return JSON.stringify(payload);
  }

  const formData = new FormData();
  const { attachments: _attachments, ...multipartPayload } = payload;
  formData.append("multipartPayload", JSON.stringify(multipartPayload));
  appendAttachmentFiles(formData, payload.attachments, true);
  return formData;
}

export function bodyForAttachmentList(attachments: AttachmentMetadataLike[], note?: string): BodyInit {
  if (!hasRealAttachmentFiles(attachments)) {
    return JSON.stringify({ attachments, ...(note ? { note } : {}) });
  }

  const formData = new FormData();
  appendAttachmentFiles(formData, attachments, true);
  if (note) {
    formData.append("note", note);
  }
  return formData;
}

export function bodyForReceiverQuickPhoto(payload: ReceiverQuickPhotoPayloadLike): BodyInit {
  const attachments = payload.attachments;
  if (!hasRealAttachmentFiles(attachments)) {
    return JSON.stringify(payload);
  }

  const formData = new FormData();
  const { attachments: _attachments, ...multipartPayload } = payload;
  formData.append("multipartPayload", JSON.stringify(multipartPayload));
  appendAttachmentFiles(formData, attachments, true);
  return formData;
}

export function bodyForExcelFile(file: File): BodyInit {
  const formData = new FormData();
  formData.append("files", file, file.name);
  return formData;
}

export async function downloadAttachment(session: DevSession, path: string) {
  return (await downloadFile(session, path)).blob;
}

function filenameFromContentDisposition(value: string | null) {
  if (!value) {
    return undefined;
  }

  const encodedMatch = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }

  const quotedMatch = /filename="([^"]+)"/i.exec(value);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  const plainMatch = /filename=([^;]+)/i.exec(value);
  return plainMatch?.[1]?.trim();
}

export async function downloadFile(
  session: DevSession,
  path: string,
  init: RequestInit = {}
): Promise<{ blob: Blob; filename?: string }> {
  return withBusinessWriteActivity(init, async () => {
    const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
    const response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: {
        ...sessionHeaders(session, { json: !isFormData && init.body !== undefined }),
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      const text = await response.text();
      let message = `HTTP ${response.status}`;
      try {
        const body = JSON.parse(text) as { error?: unknown };
        if (typeof body.error === "string") {
          message = body.error;
        }
      } catch {
        if (text.trim().length > 0) {
          message = text;
        }
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const filename = filenameFromContentDisposition(response.headers.get("content-disposition"));
    return filename ? { blob, filename } : { blob };
  });
}

export async function authRequest<T>(path: string, init: RequestInit = {}) {
  return withBusinessWriteActivity(init, async () => {
    const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
    const response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: {
        ...(init.body && !isFormData ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {})
      }
    });
    const body = jsonBodyFromResponseText(await response.text());

    throwIfNotOk(response, body);

    return body as T;
  });
}
