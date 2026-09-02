import {
  DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
  parseReceiverQrPrintSettings,
  receiverQrPrintSettingsOrDefault,
  type ReceiverQrPrintSettings
} from "@sample-room/shared";
import type { AccountRepository } from "../../db/repositories/contracts/index.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "../auth/currentUser.js";

function accountIdFor(currentUser: CurrentUser) {
  return currentUser.accountId ?? currentUser.id;
}

function settingsRecord(settings: ReceiverQrPrintSettings): Record<string, unknown> {
  return {
    ...settings,
    summaryFields: [...settings.summaryFields],
    freeform: {
      ...settings.freeform,
      qrBox: { ...settings.freeform.qrBox },
      summaryBox: { ...settings.freeform.summaryBox }
    },
    savedLayouts: settings.savedLayouts.map((layout) => ({
      ...layout,
      settings: {
        ...layout.settings,
        qrBox: { ...layout.settings.qrBox },
        summaryBox: { ...layout.settings.summaryBox }
      }
    }))
  };
}

export class ReceiverPrintSettingsService {
  constructor(private readonly accounts: AccountRepository) {}

  async get(currentUser: CurrentUser): Promise<ReceiverQrPrintSettings> {
    const stored = await this.accounts.findReceiverQrPrintSettings(accountIdFor(currentUser));
    return receiverQrPrintSettingsOrDefault(stored ?? DEFAULT_RECEIVER_QR_PRINT_SETTINGS);
  }

  async save(currentUser: CurrentUser, payload: unknown): Promise<ReceiverQrPrintSettings> {
    const settings = parseReceiverQrPrintSettings(payload);
    if (!settings) throw new HttpError(400, "receiver_print_settings_invalid");
    const saved = await this.accounts.updateReceiverQrPrintSettings(
      accountIdFor(currentUser),
      settingsRecord(settings)
    );
    return receiverQrPrintSettingsOrDefault(saved);
  }
}
