import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bodyForAttachmentList,
  bodyForOrderPayload,
  bodyForReceiverQuickPhoto,
  request
} from "./request";

afterEach(() => {
  vi.unstubAllGlobals();
});

function attachment(index: number) {
  return {
    fileName: `sample-${index}.pdf`,
    category: "client_reference",
    visibility: "client_visible",
    file: new File(["%PDF-1.7"], `sample-${index}.pdf`, { type: "application/pdf" })
  };
}

describe("multipart request encoding", () => {
  it("bundles order fields and per-file metadata into at most three text fields", () => {
    const body = bodyForOrderPayload({
      styleNo: "STYLE-001",
      styleName: "安全字段打包",
      quantity: 1,
      sampleType: "first_sample",
      sampleRound: "round_1",
      deliveryDate: "2026-08-08",
      remark: "test",
      attachments: Array.from({ length: 10 }, (_, index) => attachment(index))
    });

    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect(form.getAll("files")).toHaveLength(10);
    expect(Array.from(form.entries()).filter(([, value]) => typeof value === "string")).toHaveLength(2);
    expect(JSON.parse(String(form.get("multipartPayload")))).toMatchObject({
      styleNo: "STYLE-001",
      quantity: 1
    });
    expect(JSON.parse(String(form.get("attachmentMetadata")))).toHaveLength(10);
  });

  it("keeps attachment-list and quick-photo uploads below the ten-field limit", () => {
    const list = bodyForAttachmentList(
      Array.from({ length: 10 }, (_, index) => attachment(index)),
      "note"
    ) as FormData;
    const quick = bodyForReceiverQuickPhoto({
      customerId: "customer-1",
      clientUserId: "client-1",
      quantity: 3,
      sampleRequestItems: ["sample_garment", "pattern_making", "cutting"],
      remark: "拍照简录备注",
      thumbnailAttachmentIndex: 1,
      attachments: Array.from({ length: 10 }, (_, index) => attachment(index))
    }) as FormData;

    expect(Array.from(list.entries()).filter(([, value]) => typeof value === "string")).toHaveLength(2);
    expect(Array.from(quick.entries()).filter(([, value]) => typeof value === "string")).toHaveLength(2);
    expect(JSON.parse(String(quick.get("multipartPayload")))).toEqual({
      customerId: "customer-1",
      clientUserId: "client-1",
      quantity: 3,
      sampleRequestItems: ["sample_garment", "pattern_making", "cutting"],
      remark: "拍照简录备注",
      thumbnailAttachmentIndex: 1
    });
    expect(JSON.parse(String(quick.get("attachmentMetadata")))).toEqual(
      Array.from({ length: 10 }, () => ({ category: "client_reference", visibility: "client_visible" }))
    );
  });
});

describe("native tablet write activity", () => {
  it("guards line switching for the full duration of a business write", async () => {
    const setBusinessWriteActive = vi.fn();
    vi.stubGlobal("window", {
      SampleRoomTablet: { setBusinessWriteActive },
      dispatchEvent: vi.fn()
    });
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })));
    const session = { authMode: "formal" } as Parameters<typeof request>[0];

    const pending = request<{ ok: boolean }>(session, "/api/orders", {
      method: "POST",
      body: JSON.stringify({ styleNo: "WRITE-GUARD" })
    });
    expect(setBusinessWriteActive).toHaveBeenCalledWith(true);

    resolveFetch(new Response('{"ok":true}', { status: 200 }));
    await expect(pending).resolves.toEqual({ ok: true });
    expect(setBusinessWriteActive).toHaveBeenLastCalledWith(false);
  });

  it("does not block line switching for read requests", async () => {
    const setBusinessWriteActive = vi.fn();
    vi.stubGlobal("window", {
      SampleRoomTablet: { setBusinessWriteActive },
      dispatchEvent: vi.fn()
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"ok":true}', { status: 200 })));
    const session = { authMode: "formal" } as Parameters<typeof request>[0];

    await request(session, "/api/orders");
    expect(setBusinessWriteActive).not.toHaveBeenCalled();
  });
});
