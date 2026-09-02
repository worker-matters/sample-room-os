import { randomUUID } from "node:crypto";
import { sampleTypeOptions } from "@sample-room/shared";
import type {
  OperationLogRepository,
  SystemSettingRepository
} from "../../db/repositories/contracts/index.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "../auth/currentUser.js";
import type { SampleTypeDefinition, SampleTypeMoveDirection, SampleTypeOption } from "./sampleTypeTypes.js";

export const SAMPLE_TYPE_SETTING_KEY = "sample_type_definitions_v1";

export const DEFAULT_SAMPLE_TYPE_DEFINITIONS: SampleTypeDefinition[] = sampleTypeOptions.map(
  ({ value, label }) => ({ code: value, name: label })
);

const copyDefinitions = (items: SampleTypeDefinition[]) => items.map((item) => ({ ...item }));

function storedDefinitions(value: unknown): SampleTypeDefinition[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const items: SampleTypeDefinition[] = [];
  for (const item of value) {
    if (
      typeof item !== "object" || item === null ||
      typeof (item as { code?: unknown }).code !== "string" ||
      typeof (item as { name?: unknown }).name !== "string"
    ) return undefined;
    const code = (item as { code: string }).code.trim();
    const name = (item as { name: string }).name.trim();
    if (!code || !name) return undefined;
    items.push({ code, name });
  }
  return items;
}

function normalizedName(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "样衣类型名称不能为空。");
  }
  return value.trim();
}

export class SampleTypeService {
  constructor(
    private readonly systemSettings: SystemSettingRepository,
    private readonly operationLogs: OperationLogRepository
  ) {}

  async listDefinitions(): Promise<SampleTypeDefinition[]> {
    const record = await this.systemSettings.findSystemSetting(SAMPLE_TYPE_SETTING_KEY);
    return copyDefinitions(storedDefinitions(record?.value) ?? DEFAULT_SAMPLE_TYPE_DEFINITIONS);
  }

  async listOptions(): Promise<SampleTypeOption[]> {
    return (await this.listDefinitions()).map(({ code, name }) => ({ value: code, label: name }));
  }

  async requireWritableCode(value: unknown): Promise<string> {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new HttpError(400, "sampleType is required.");
    }
    const code = value.trim();
    if (!(await this.listDefinitions()).some((item) => item.code === code)) {
      throw new HttpError(400, "sampleType is not a current sample type.");
    }
    return code;
  }

  async requireWritableCodeForUpdate(value: unknown, currentCode: string): Promise<string> {
    if (typeof value === "string" && value.trim() === currentCode) return currentCode;
    return this.requireWritableCode(value);
  }

  async create(nameValue: unknown, actor: CurrentUser): Promise<SampleTypeDefinition[]> {
    const name = normalizedName(nameValue);
    const items = await this.listDefinitions();
    this.ensureUniqueName(items, name);
    const created = { code: `custom_${randomUUID().replaceAll("-", "")}`, name };
    const next = [...items, created];
    await this.save(next, actor);
    await this.operationLogs.appendOperationLog({
      actorId: actor.accountId ?? actor.id,
      actorRole: actor.role,
      action: "sample_type_created",
      targetType: "sample_type",
      targetId: created.code,
      before: {},
      after: created
    });
    return next;
  }

  async rename(code: string, nameValue: unknown, actor: CurrentUser): Promise<SampleTypeDefinition[]> {
    const name = normalizedName(nameValue);
    const items = await this.listDefinitions();
    const index = this.requireIndex(items, code);
    this.ensureUniqueName(items, name, code);
    const before = { ...items[index]! };
    const next = copyDefinitions(items);
    next[index] = { code, name };
    await this.save(next, actor);
    await this.operationLogs.appendOperationLog({
      actorId: actor.accountId ?? actor.id,
      actorRole: actor.role,
      action: "sample_type_renamed",
      targetType: "sample_type",
      targetId: code,
      before,
      after: next[index]
    });
    return next;
  }

  async move(code: string, directionValue: unknown, actor: CurrentUser): Promise<SampleTypeDefinition[]> {
    if (directionValue !== "up" && directionValue !== "down") {
      throw new HttpError(400, "direction must be up or down.");
    }
    const direction: SampleTypeMoveDirection = directionValue;
    const items = await this.listDefinitions();
    const index = this.requireIndex(items, code);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) {
      throw new HttpError(400, "sample type cannot move beyond the list boundary.");
    }
    const before = copyDefinitions(items);
    const next = copyDefinitions(items);
    [next[index], next[targetIndex]] = [next[targetIndex]!, next[index]!];
    await this.save(next, actor);
    await this.operationLogs.appendOperationLog({
      actorId: actor.accountId ?? actor.id,
      actorRole: actor.role,
      action: "sample_type_moved",
      targetType: "sample_type",
      targetId: code,
      before: { items: before },
      after: { items: next }
    });
    return next;
  }

  private ensureUniqueName(items: SampleTypeDefinition[], name: string, exceptCode?: string) {
    if (items.some((item) => item.code !== exceptCode && item.name === name)) {
      throw new HttpError(400, "样衣类型名称已存在。");
    }
  }

  private requireIndex(items: SampleTypeDefinition[], code: string) {
    const index = items.findIndex((item) => item.code === code);
    if (index < 0) throw new HttpError(404, "sample type not found.");
    return index;
  }

  private async save(items: SampleTypeDefinition[], actor: CurrentUser) {
    await this.systemSettings.upsertSystemSetting({
      key: SAMPLE_TYPE_SETTING_KEY,
      value: items,
      updatedBy: actor.accountId ?? actor.id
    });
  }
}
