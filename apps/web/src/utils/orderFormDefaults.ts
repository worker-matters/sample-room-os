import type { CreateOrderPayload, SelfEntryPayload } from "../api/sampleRoomApi";
import { DEFAULT_SAMPLE_REQUEST_ITEMS } from "@sample-room/shared";
import { getDefaultDeliveryDate } from "./defaultDeliveryDate";

export function createDefaultOrderValues(now?: Date): CreateOrderPayload {
  return {
    styleNo: "",
    styleName: "",
    quantity: 1,
    sampleType: "first_sample",
    sampleRound: "round_1",
    patternStatus: "none",
    deliveryDate: getDefaultDeliveryDate(now),
    remark: "",
    sampleRequestItems: DEFAULT_SAMPLE_REQUEST_ITEMS
  };
}

export function createDefaultReceiverSelfEntryValues(now?: Date): SelfEntryPayload {
  return {
    customerId: "mock-customer-active",
    clientUserId: "mock-client-user-active",
    styleNo: "",
    styleName: "",
    quantity: 1,
    sampleType: "first_sample",
    sampleRound: "round_1",
    deliveryDate: getDefaultDeliveryDate(now),
    patternStatus: "none",
    fabricStatus: "missing",
    trimStatus: "missing",
    remark: "",
    sampleRequestItems: DEFAULT_SAMPLE_REQUEST_ITEMS
  };
}
