import { beforeEach, describe, expect, it } from "vitest";
import { ROLES, type Role } from "@sample-room/shared";
import {
  InMemoryOperationLogRepository,
  InMemorySystemSettingRepository
} from "../../db/repositories/memory/inMemorySystemRepositories.js";
import type { CurrentUser } from "../auth/currentUser.js";
import {
  DEFAULT_SAMPLE_TYPE_DEFINITIONS,
  SampleTypeService
} from "./sampleTypeService.js";

const actor = (role: Role): CurrentUser => ({ id: `${role}-id`, accountId: `${role}-id`, role });

describe("SampleTypeService", () => {
  let settings: InMemorySystemSettingRepository;
  let logs: InMemoryOperationLogRepository;
  let service: SampleTypeService;

  beforeEach(() => {
    settings = new InMemorySystemSettingRepository();
    logs = new InMemoryOperationLogRepository();
    service = new SampleTypeService(settings, logs);
  });

  it("returns the four defaults in business order when no setting exists", async () => {
    await expect(service.listDefinitions()).resolves.toEqual(DEFAULT_SAMPLE_TYPE_DEFINITIONS);
    expect((await service.listOptions()).map((item) => item.value)).toEqual([
      "first_sample", "fit_sample", "revision_sample", "pre_production_sample"
    ]);
  });

  it("creates a trimmed type at the end with a server-generated stable code", async () => {
    const items = await service.create("  大货样  ", actor(ROLES.boss));
    expect(items.at(-1)).toMatchObject({ name: "大货样" });
    expect(items.at(-1)?.code).toMatch(/^custom_[0-9a-f]{32}$/);
  });

  it("rejects empty and duplicate names", async () => {
    await expect(service.create("  ", actor(ROLES.boss))).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.create("初样", actor(ROLES.boss))).rejects.toMatchObject({ statusCode: 400 });
  });

  it("renames without changing code and moves adjacent items in both directions", async () => {
    const renamed = await service.rename("first_sample", "一次样", actor(ROLES.systemOwner));
    expect(renamed[0]).toEqual({ code: "first_sample", name: "一次样" });
    const movedDown = await service.move("first_sample", "down", actor(ROLES.systemOwner));
    expect(movedDown.slice(0, 2).map((item) => item.code)).toEqual(["fit_sample", "first_sample"]);
    const movedUp = await service.move("first_sample", "up", actor(ROLES.systemOwner));
    expect(movedUp.slice(0, 2).map((item) => item.code)).toEqual(["first_sample", "fit_sample"]);
    await expect(service.move("first_sample", "up", actor(ROLES.boss))).rejects.toMatchObject({ statusCode: 400 });
  });

  it("accepts configured codes and keeps an unchanged unknown historical code on update", async () => {
    const created = await service.create("展示样", actor(ROLES.boss));
    const code = created.at(-1)!.code;
    await expect(service.requireWritableCode(code)).resolves.toBe(code);
    await expect(service.requireWritableCode("unknown_type")).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.requireWritableCodeForUpdate("legacy_type", "legacy_type")).resolves.toBe("legacy_type");
  });

  it("writes create, rename and move audit records with actor and before/after data", async () => {
    const created = await service.create("展示样", actor(ROLES.boss));
    const code = created.at(-1)!.code;
    await service.rename(code, "确认样", actor(ROLES.systemOwner));
    await service.move(code, "up", actor(ROLES.systemOwner));
    const records = await logs.listOperationLogs();
    expect(records.map((item) => item.action)).toEqual([
      "sample_type_created", "sample_type_renamed", "sample_type_moved"
    ]);
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorId: "boss-id", actorRole: ROLES.boss, targetId: code, after: expect.any(Object) }),
      expect.objectContaining({ actorId: "system_owner-id", actorRole: ROLES.systemOwner, targetId: code, before: expect.any(Object), after: expect.any(Object) })
    ]));
  });
});
